# Fixes applied to the Burnside level inside Blender, just before it is exported (tools/export-blend.py ... this file).
#   1. The Spawn_* empties all sit at the origin; the real position is in their `position` property (glTF coordinates, Y up). Move them there
#      (Blender: x, -z, y), or every spawn is the middle of the level.
import bpy


def apply():
    for o in bpy.data.objects:
        if o.get('role') != 'spawn' or 'position' not in o:
            continue
        x, y, z = (float(v) for v in o['position'])
        o.location = (x, -z, y)

