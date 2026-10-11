# Exports a level .blend to a raw GLB (applying modifiers, keeping custom properties as glTF extras) without opening Blender:
#   uv venv .venv-bpy --python 3.13 && uv pip install --python .venv-bpy/bin/python bpy
#   .venv-bpy/bin/python tools/export-blend.py -- <level.blend> <out.raw.glb> <textures-dir> [tools/patches/<level>.py]
# The blend's textures may be linked from a library file that is not available; any image named <name>.(webp|jpg|png) in the
# textures directory is attached in its place (dump-textures.mjs can pull them from an existing game GLB).
# An optional patch file (a module with apply()) is run inside Blender just before export, for fixes to the model that should
# be repeated on every new version of the level (see tools/patches/eastbank.py).
# Then:  node tools/optimise-level.mjs <out.raw.glb> dist/assets/levels/<level>.glb
import bpy, sys, os

args = sys.argv[sys.argv.index('--') + 1:]
src, out, texdir = args[:3]
patch = args[3] if len(args) > 3 else None
bpy.ops.wm.open_mainfile(filepath=src)
attached = 0
for img in bpy.data.images:
    base = os.path.splitext(img.name)[0]
    for ext in ('webp', 'jpg', 'png'):
        path = os.path.join(texdir, f'{base}.{ext}')
        if not os.path.exists(path):
            continue
        if img.library is not None:
            local = bpy.data.images.load(path, check_existing=False)
            local.name = base + '_local'
            img.user_remap(local)
            local.name = base
        else:
            img.filepath = path
            img.reload()
        attached += 1
        break
print('textures attached', attached, 'of', len(bpy.data.images))
if patch:
    import importlib.util
    spec = importlib.util.spec_from_file_location('level_patch', patch)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.apply()
    print('applied patch', patch)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_extras=True,
    export_cameras=False, export_lights=False, use_visible=False, use_selection=False,
    export_image_format='WEBP', export_texcoords=True, export_normals=True, export_vertex_color='ACTIVE',
    export_materials='EXPORT', export_animations=False, export_skins=False)
print('exported', out, os.path.getsize(out), 'bytes')
