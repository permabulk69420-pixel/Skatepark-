# Fixes applied to the Eastbank school inside Blender, just before it is exported (tools/export-blend.py ... --patch this file).
# They are keyed by object name, so they keep working when a new version of the .blend arrives with the same names; if Codex
# fixes the same thing itself, the patch is harmless (a few centimetres, or an extra pocket under something already dug).
#
#   1. The terrain slab (top at y = -0.4) was drawn over everything lower than that: the drainage basin (1.8 m deep) and the
#      Forum plaza (1.1 m down) were buried, so only their top lips showed over a dark floor. Dig pockets out of the terrain.
#   2. Several big surfaces were modelled at exactly the same height on top of each other (roads over the concrete extension
#      and so on), which z-fights. Move them 2 cm apart. Thin joint/marking lines are decals; the game gives those a depth offset.
#   3. The grass outside the campus had no collision (you fell through it); copy it to collision.
#   4. The ground around the campus is concrete rather than a dark loam that read as a void.
#   5. One brick pier (UpperTerrace_SupportPier4) held nothing up and stuck out through the mid landing: removed.
#   6. The Locker Hall floor slab hovered 0.5 m above the ground with nothing under it: give it a base (and collision).
#   8. Four signs (Admin, Canteen, Gym, LedgePlaza) faced into their buildings, so their letters were only ever seen mirrored from behind:
#      turn them round.
#   9. Real frames round the windows and doors, and handles (eastbank_details.py).
#   7. The dock stairs ran straight into a ledge block sitting across the top step: slide the ledge (and its grind lines) along
#      the landing so the stairs open onto it.
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


def turn_round(name):
    """Rotate an object 180 degrees about the vertical axis through the middle of its bounding box (a flat sign that faced the wrong way)."""
    o = bpy.data.objects.get(name)
    if o is None:
        return
    import mathutils
    corners = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    centre = sum(corners, mathutils.Vector()) / len(corners)
    t = mathutils.Matrix.Translation(centre)
    o.matrix_world = t @ mathutils.Matrix.Rotation(math.pi, 4, 'Z') @ t.inverted() @ o.matrix_world


def replace_material(obj_name, old_part, new_name):
    o = bpy.data.objects.get(obj_name)
    new = bpy.data.materials.get(new_name)
    if o is None or new is None:
        return
    for i, m in enumerate(o.data.materials):
        if m is not None and old_part in m.name:
            o.data.materials[i] = new


def remove(name):
    o = bpy.data.objects.get(name)
    if o is not None:
        bpy.data.objects.remove(o, do_unlink=True)


def add_box(name, gx0, gx1, gz0, gz1, gy0, gy1, material, role):
    """A solid box in glTF extents (Blender y = -glTF z)."""
    mat = bpy.data.materials.get(material)
    bpy.ops.mesh.primitive_cube_add(size=2, location=((gx0 + gx1) / 2, -(gz0 + gz1) / 2, (gy0 + gy1) / 2))
    o = bpy.context.active_object
    o.scale = ((gx1 - gx0) / 2, (gz1 - gz0) / 2, (gy1 - gy0) / 2)
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.name = name
    o.data.name = name
    o.data.materials.clear()
    if mat is not None:
        o.data.materials.append(mat)
    o['role'] = role
    return o


def shift_x(name, dx):
    o = bpy.data.objects.get(name)
    if o is None:
        return
    o.location.x += dx
    pts = o.get('points')
    if pts is not None:       # grind paths keep their own world-space points
        shifted = [float(v) for v in pts]
        for i in range(0, len(shifted), 3):
            shifted[i] += dx
        o['points'] = shifted


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
    # the ground around the campus is concrete
    concrete = 'Concrete | trowelled aggregate / 4m repeat'
    for name in ('Surrounding_Earth', 'Surrounding_Ground_West', 'Surrounding_Ground_East', 'Surrounding_Ground_North', 'Surrounding_Ground_South'):
        replace_material(name, 'Landscape', concrete)
    # a pier that holds nothing up
    remove('UpperTerrace_SupportPier4')
    remove('COL_UpperTerrace_SupportPier4')
    # a base under the Locker Hall floor
    add_box('LockerHall_Plinth', 78.0, 92.0, -34.0, 16.0, -0.1, 0.5, concrete, 'environment')
    add_box('COL_LockerHall_Plinth', 78.0, 92.0, -34.0, 16.0, -0.1, 0.5, 'Collision | inspection only', 'collision')
    # dock stairs: the ledge that sat across the top step moves along the landing (it is 10 m long, the stairs 5 m wide)
    for name in ('ServiceDock_LandingLedge', 'COL_ServiceDock_LandingLedge', 'PATH_ServiceDock_LandingLedge_Edge0', 'PATH_ServiceDock_LandingLedge_Edge1',
                 'PATH_ServiceDock_LandingLedge_Edge2', 'PATH_ServiceDock_LandingLedge_Edge3'):
        shift_x(name, -4.0)
    # signs that faced into their buildings
    for name in ('Admin_Sign', 'Canteen_Sign', 'Gym_FrontSign', 'LedgePlaza_Sign'):
        turn_round(name)
    # rideable ground outside the campus (and under it, so nothing can drop through a gap)
    for name in ('Surrounding_Ground_West', 'Surrounding_Ground_East', 'Surrounding_Ground_North', 'Surrounding_Ground_South', 'Surrounding_Earth'):
        copy_as_collision(name, f'COL_Landscape_Outer_{name.split("_", 1)[1]}')
    # frames and handles (separate module, same patch run)
    import importlib.util, os
    spec = importlib.util.spec_from_file_location('eastbank_details', os.path.join(os.path.dirname(__file__), 'eastbank_details.py'))
    details = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(details)
    details.apply()
