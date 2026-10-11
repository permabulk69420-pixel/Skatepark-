# Extra modelling for the Eastbank school, built inside Blender just before export (called from eastbank.py).
# The model had windows and doors as bare flat panels sitting in the wall plane. This adds real frames around the window panes, frames and
# lever handles on the doors, so they read as doors and windows up close. It is keyed by object name, one merged mesh per kind, a few
# hundred triangles in all.
import re
import bpy
import bmesh
from mathutils import Vector

FRAME = 'Steel | graphite powdercoat'
HANDLE = 'Steel | brushed galvanized coping'


def bounds(o):
    """glTF-space extents (x0, x1, z0, z1, y0, y1) of an object; Blender y = -glTF z, Blender z = glTF y."""
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
    return min(xs), max(xs), -max(ys), -min(ys), min(zs), max(zs)


def box(bm, x0, x1, z0, z1, y0, y1):
    """Add an axis-aligned box given in glTF extents."""
    bmesh.ops.create_cube(bm, size=1.0, matrix=_scale_move((x0 + x1) / 2, -(z0 + z1) / 2, (y0 + y1) / 2, x1 - x0, z1 - z0, y1 - y0))


def _scale_move(cx, cy, cz, sx, sy, sz):
    from mathutils import Matrix
    m = Matrix.Translation((cx, cy, cz))
    for i, s in enumerate((sx, sy, sz)):
        m[i][i] = s
    return m


def frame_pane(bm, b, border=0.06, depth=0.05):
    """Four bars round a pane (thin in x or z) standing proud of the wall on both faces."""
    x0, x1, z0, z1, y0, y1 = b
    half = border / 2
    if (x1 - x0) < (z1 - z0):          # pane in the y-z plane, thin in x
        px0, px1 = x0 - depth, x1 + depth
        box(bm, px0, px1, z0 - half, z0 + half, y0 - half, y1 + half)
        box(bm, px0, px1, z1 - half, z1 + half, y0 - half, y1 + half)
        box(bm, px0, px1, z0 + half, z1 - half, y0 - half, y0 + half)
        box(bm, px0, px1, z0 + half, z1 - half, y1 - half, y1 + half)
    else:                               # pane in the x-y plane, thin in z
        pz0, pz1 = z0 - depth, z1 + depth
        box(bm, x0 - half, x0 + half, pz0, pz1, y0 - half, y1 + half)
        box(bm, x1 - half, x1 + half, pz0, pz1, y0 - half, y1 + half)
        box(bm, x0 + half, x1 - half, pz0, pz1, y0 - half, y0 + half)
        box(bm, x0 + half, x1 - half, pz0, pz1, y1 - half, y1 + half)


def handle(bm, b, height=1.0, inset=0.12):
    """A lever handle on each face of a door slab, at the latch end."""
    x0, x1, z0, z1, y0, y1 = b
    hy = min(y0 + height, y1 - 0.3)
    if (x1 - x0) < (z1 - z0):          # slab thin in x: handle sits near the +z edge
        cz = z1 - inset
        for fx0, fx1 in ((x0 - 0.07, x0), (x1, x1 + 0.07)):
            box(bm, fx0, fx1, cz - 0.015, cz + 0.015, hy - 0.015, hy + 0.015)
            box(bm, fx0, fx1, cz - 0.09, cz + 0.015, hy - 0.015, hy)        # backplate-length lever along the door
    else:
        cx = x1 - inset
        for fz0, fz1 in ((z0 - 0.07, z0), (z1, z1 + 0.07)):
            box(bm, cx - 0.015, cx + 0.015, fz0, fz1, hy - 0.015, hy + 0.015)
            box(bm, cx - 0.09, cx + 0.015, fz0, fz1, hy - 0.015, hy)


def finish(bm, name, material):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.get(material)
    if mat is not None:
        mesh.materials.append(mat)
    obj['role'] = 'environment'
    return obj


WINDOWS = r'^(Academic_EastWindow_|Admin_SouthWindow_|LockerHall_(East|West)_Window)'
DOORS = r'^(Academic_L\d+_Class\d+_Door$|Admin_Door$|Canteen_EntranceDoor$|Gym_EntryDoor_|Library_EntranceDoor$|LockerHall_(North|South)_OpenDoor)'


def apply():
    frames, handles = bmesh.new(), bmesh.new()
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or o.get('role') == 'collision':
            continue
        if re.search(WINDOWS, o.name):
            frame_pane(frames, bounds(o))
        elif re.search(DOORS, o.name):
            b = bounds(o)
            frame_pane(frames, b, border=0.08, depth=0.045)
            handle(handles, b)
    finish(frames, 'Details_WindowDoorFrames', FRAME)
    finish(handles, 'Details_DoorHandles', HANDLE)
