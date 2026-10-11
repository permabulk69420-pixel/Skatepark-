# Fixes applied to the Eastbank school inside Blender, just before it is exported (tools/export-blend.py ... --patch this file).
# They are keyed by object name, so they keep working when a new version of the .blend arrives with the same names; if Codex
# fixes the same thing itself, the patch is harmless (a few centimetres, or an extra pocket under something already dug).
#
#   1. The terrain slab (top at y = -0.4) was drawn over everything lower than that: the drainage basin (1.8 m deep) and the
#      Forum plaza (1.1 m down) were buried, so only their top lips showed over a dark floor. Dig pockets out of the terrain.
#   2. Several big surfaces were modelled at exactly the same height on top of each other (roads over the concrete extension
#      and so on), which z-fights. Move them 2 cm apart. Thin joint/marking lines are decals; the game gives those a depth offset.
#   3. The grass outside the campus had no collision (you fell through it); copy it to collision.
import bpy
import math


def lift(name, dz):
    o = bpy.data.objects.get(name)
    if o is not None:
        o.location.z += dz


def pocket(earth, gx0, gx1, gz0, gz1, floor=-2.8):
    """Cut a rectangular pocket out of the top of `earth` (glTF x / z extents, Blender z up, so Blender y = -glTF z)."""
    by0, by1 = -gz1, -gz0
    bpy.ops.mesh.primitive_cube_add(size=2, location=((gx0 + gx1) / 2, (by0 + by1) / 2, (floor + 2.0) / 2))
    cutter = bpy.context.active_object
    cutter.scale = ((gx1 - gx0) / 2, (by1 - by0) / 2, (2.0 - floor) / 2)
    mod = earth.modifiers.new('pocket', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    with bpy.context.temp_override(object=earth, active_object=earth, selected_objects=[earth]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def copy_as_collision(name, new_name):
    src = bpy.data.objects.get(name)
    mat = bpy.data.materials.get('Collision | inspection only')
    if src is None or mat is None:
        return
    new = src.copy()
    new.data = src.data.copy()
    new.name = new_name
    new.data.materials.clear()
    new.data.materials.append(mat)
    new['role'] = 'collision'
    for c in src.users_collection:
        c.objects.link(new)


def apply():
    earth = bpy.data.objects.get('Surrounding_Earth')
    if earth is not None:
        pocket(earth, -60.0, -26.0, -31.0, -13.0)     # retention basin
        pocket(earth, -23.0, 5.0, -17.0, 1.0)         # Forum plaza and its terraces
    # layering: asphalt strips sit just under the concrete they run into, the service road just over it
    lift('WestService_Asphalt', -0.02)
    lift('EastConcourse_Asphalt', -0.02)
    lift('North_Service_Road', 0.02)
    lift('LockerHall_TimberRunway', 0.02)
    # rideable ground outside the campus (and under it, so nothing can drop through a gap)
    for name in ('Surrounding_Ground_West', 'Surrounding_Ground_East', 'Surrounding_Ground_North', 'Surrounding_Ground_South', 'Surrounding_Earth'):
        copy_as_collision(name, f'COL_Landscape_Outer_{name.split("_", 1)[1]}')
