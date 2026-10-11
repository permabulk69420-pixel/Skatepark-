# Re-shapes the school's quarter-pipes inside Blender, just before export (called from eastbank.py).
#
# Every quarter-pipe in the model (the drainage half-pipe's two walls, the spine, the wall quarters) is a prism with a circular
# transition of a radius larger than its height, cut off where it reaches the deck: it meets the coping at about 59°, with the deck
# flat beyond. A board rolling up that never launches properly (it climbs the last centimetres glued to the face, gets caught on the
# corner and sinks into the solid), and nothing in the game's ramp physics expects it: real quarters, and the game's test pipe, end
# vertical with a little vertical wall under the coping.
#
# This keeps each prism's footprint, height, coping and number of vertices and changes only the profile: a flat run, a quarter circle
# of radius R, then a short vertical to the same top. The collision copy (COL_<name>) gets exactly the same treatment.
import math
import re
import bpy

VERTICAL = 0.3        # metres of vertical wall under the coping
MIN_RADIUS = 0.6


def profile_vertices(mesh):
    """Splits a prism's vertices into its two end profiles along the extrusion axis; returns (arc_axis, ends)."""
    verts = mesh.vertices
    def distinct(axis):
        return len({round(v.co[axis], 3) for v in verts})
    # the arc runs along whichever horizontal axis has many distinct values; the other is the extrusion
    arc_axis = 0 if distinct(0) > distinct(1) else 1
    ext_axis = 1 - arc_axis
    values = sorted({round(v.co[ext_axis], 3) for v in verts})
    if len(values) != 2:
        return None
    ends = [[v for v in verts if round(v.co[ext_axis], 3) == e] for e in values]
    return arc_axis, ends


def reshape(obj):
    mesh = obj.data
    split = profile_vertices(mesh)
    if split is None:
        return False
    arc_axis, ends = split
    for end in ends:
        zmin = min(v.co.z for v in end)
        arc = sorted((v for v in end if v.co.z > zmin + 1e-4), key=lambda v: v.co.z)
        # the vertex above the bottom corners that sits at the very top of the face is the last arc point; the arc vertices are those
        # that are not the straight vertical/bottom edges: order by position along the arc axis from the floor end
        if len(arc) < 8:
            return False
        s_floor = min(arc, key=lambda v: v.co.z).co[arc_axis]
        s_top = max(arc, key=lambda v: v.co.z).co[arc_axis]
        sign = 1.0 if s_top > s_floor else -1.0
        arc.sort(key=lambda v: (v.co[arc_axis] - s_floor) * sign)
        z_floor = min(v.co.z for v in arc)
        z_top = max(v.co.z for v in arc)
        run = abs(s_top - s_floor)
        rise = z_top - z_floor
        radius = min(run, rise - VERTICAL)
        if radius < MIN_RADIUS:
            return False
        flat = run - radius
        quarter = math.pi * radius / 2
        vertical = rise - radius
        total = flat + quarter + vertical
        n = len(arc)
        for k, v in enumerate(arc):
            d = total * k / (n - 1)
            if d <= flat:
                s, z = flat and d or 0.0, 0.0
            elif d <= flat + quarter:
                th = (d - flat) / radius
                s, z = flat + radius * math.sin(th), radius * (1 - math.cos(th))
            else:
                s, z = flat + radius, radius + (d - flat - quarter)
            v.co[arc_axis] = s_floor + sign * s
            v.co.z = z_floor + z
    mesh.update()
    return True


# visual objects; each also has a COL_ twin
QUARTERS = ['Drainage_Halfpipe_East', 'Drainage_Halfpipe_West', 'Drainage_Spine_North', 'Drainage_Spine_South', 'LedgePlaza_LearningWallRide',
            'LockerHall_WallQuarter', 'Quad_GymWallQuarter', 'ServiceDock_WorkshopQuarter', 'UpperTerrace_NorthQuarter']


def apply():
    for name in QUARTERS:
        for n in (name, 'COL_' + name):
            obj = bpy.data.objects.get(n)
            if obj is not None and obj.type == 'MESH' and len(obj.data.vertices) == 86:
                # an object is only reshaped if its data is not shared with an object that is not (they are separate meshes in the model)
                reshape(obj)
