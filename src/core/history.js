import { project as P, captureState, applyState } from './model.js';

const undoStack = [];
const redoStack = [];
const LIMIT = 50;
let pending = null; // snapshot taken at gesture start

// Snapshot BEFORE a mutation, run it, then render happens by the caller.
export function mutate(fn) {
  push(captureState(P));
  fn();
}

// For continuous gestures: begin() once, then commit() once at the end,
// so the whole drag collapses into a single undo entry.
export function beginGesture() { pending = captureState(P); }
export function commitGesture() {
  if (pending == null) return;
  push(pending);
  pending = null;
}
export function cancelGesture() { pending = null; }

function push(snap) {
  undoStack.push(snap);
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(captureState(P));
  applyState(P, undoStack.pop());
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(captureState(P));
  applyState(P, redoStack.pop());
  return true;
}

export function clearHistory() { undoStack.length = 0; redoStack.length = 0; pending = null; }
export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
