# Fixes applied to the Burnside level inside Blender, just before it is exported (tools/export-blend.py ... this file).
#   1. The Spawn_* empties all sit at the origin; the real position is in their `position` property (glTF coordinates, Y up). Move them there
#      (Blender: x, -z, y), or every spawn is the middle of the level.
#   2. The model is a compact park with plain blocks round it and nothing else: past the roads and under the banks there was no ground at all,
#      just the sky colour showing through ("giant holes"). Lay a big concrete floor below the lowest point of the level (and a matching
#      collision floor, so a fall lands on it rather than going on forever).
import bpy
import bmesh


def apply():
    for o in bpy.data.objects:
        if o.get('role') != 'spawn' or 'position' not in o:
            continue
        x, y, z = (float(v) for v in o['position'])
        o.location = (x, -z, y)
    ground_floor()


def ground_floor(y=-2.6, half=300.0, tile=6.0):
    mat = bpy.data.materials.get('MAT_Concrete_Worn')
    for name, role in (('ENV_Ground_Floor', 'environment'), ('COL_Ground_Floor', 'collision')):
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        # Blender y = -glTF z; the quad faces up (+Z in Blender).
        verts = [bm.verts.new((sx * half, sy * half, y)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        face = bm.faces.new(verts)
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x / tile, loop.vert.co.y / tile)
        mesh = bpy.data.meshes.new(name)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if role == 'collision':
            col = bpy.data.materials.get('MAT_Collision_Debug')
            if col is not None:
                mesh.materials.append(col)
        elif mat is not None:
            mesh.materials.append(mat)
        obj['role'] = role
        if role == 'collision':
            obj.hide_render = True
