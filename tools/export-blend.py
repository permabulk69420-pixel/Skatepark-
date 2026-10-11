# Exports a level .blend to a raw GLB (applying modifiers, keeping custom properties as glTF extras) without opening Blender:
#   uv venv .venv-bpy --python 3.13 && uv pip install --python .venv-bpy/bin/python bpy
#   .venv-bpy/bin/python tools/export-blend.py -- <level.blend> <out.raw.glb> <textures-dir>
# The blend's textures may be linked from a library file that is not available; any image named <name>.(webp|jpg|png) in the
# textures directory is attached in its place (dump-textures.mjs can pull them from an existing game GLB).
# Then:  node tools/optimise-level.mjs <out.raw.glb> dist/assets/levels/<level>.glb
import bpy, sys, os

src, out, texdir = sys.argv[sys.argv.index('--') + 1:][:3]
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
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_yup=True, export_apply=True, export_extras=True,
    export_cameras=False, export_lights=False, use_visible=False, use_selection=False,
    export_image_format='WEBP', export_texcoords=True, export_normals=True, export_vertex_color='ACTIVE',
    export_materials='EXPORT', export_animations=False, export_skins=False)
print('exported', out, os.path.getsize(out), 'bytes')
