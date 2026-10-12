import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { outline, pickGrab, grabName, GRAB } from '../dist/src/skate/board-grab.js';

// A stand-in board (a finely cut box, like a real deck mesh): a deck-named box 0.2 wide and 0.81 long, nose toward -z, its top 0.145 above the origin.
function board() {
  const root = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.81, 20, 1, 40), new THREE.MeshBasicMaterial());
  deck.name = 'Deck_and_hardware';
  deck.position.y = 0.139;
  root.add(deck);
  root.updateMatrixWorld(true);
  return root;
}

test('the hand takes the part of the board it is nearest to', () => {
  const shape = outline(board());
  assert.ok(shape, 'the deck outline is found');
  const at = (x, y, z) => pickGrab(new THREE.Vector3(x, y, z), shape).part;
  assert.equal(at(0, 0.3, 0.45), 'tail');
  assert.equal(at(0, 0.3, -0.45), 'nose');
  assert.equal(at(0.2, 0.3, 0.02), 'right');
  assert.equal(at(-0.2, 0.3, 0.02), 'left');
});

test('grab points sit on the real edge of the deck', () => {
  const shape = outline(board());
  const tail = pickGrab(new THREE.Vector3(0, 0.3, 0.5), shape);
  const nose = pickGrab(new THREE.Vector3(0, 0.3, -0.5), shape);
  const right = pickGrab(new THREE.Vector3(0.3, 0.3, 0), shape);
  assert.ok(Math.abs(tail.point.z - 0.405) < 0.01 && Math.abs(nose.point.z + 0.405) < 0.01);
  assert.ok(Math.abs(right.point.x - 0.1) < 0.01);
  assert.ok(Math.abs(tail.point.y - 0.139) < 0.01, 'halfway up the deck thickness');
});

test('side grabs stay within the middle stretch of the deck', () => {
  const shape = outline(board());
  const side = pickGrab(new THREE.Vector3(0.14, 0.2, 0.12), shape);
  assert.equal(side.part, 'right');
  assert.ok(Math.abs(side.point.z) <= GRAB.between + 1e-6);
});

test('grabs are named by the hand and the edge, nose and tail whichever the hand', () => {
  assert.equal(grabName('nose', 'left'), 'Nose grab');
  assert.equal(grabName('tail', 'right'), 'Tail grab');
  assert.equal(grabName('right', 'right'), 'Indy');
  assert.equal(grabName('right', 'left'), 'Stalefish');
  assert.equal(grabName('left', 'left'), 'Melon');
  assert.equal(grabName('left', 'right'), 'Mute');
});
