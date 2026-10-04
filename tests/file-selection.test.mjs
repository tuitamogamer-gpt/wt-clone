import assert from "node:assert/strict";
import test from "node:test";
import { canPreview, formatFileCount, readDroppedFiles } from "../src/file-selection.ts";

function fileEntry(file) {
  return {
    name: file.name,
    isFile: true,
    isDirectory: false,
    file: (resolve) => queueMicrotask(() => resolve(file)),
  };
}

function directory(name, batches) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let index = 0;
      return { readEntries: (resolve) => queueMicrotask(() => resolve(batches[index++] || [])) };
    },
  };
}

test("reads all directory batches and keeps paths for nested files", async () => {
  const first = new File(["a"], "first.txt");
  const nested = new File(["b"], "nested.txt");
  const last = new File(["c"], "last.txt");
  const root = directory("Project", [
    [fileEntry(first), directory("Notes", [[fileEntry(nested)]])],
    [fileEntry(last)],
  ]);
  const result = await readDroppedFiles({
    items: [{ kind: "file", webkitGetAsEntry: () => root, getAsFile: () => null }],
    files: [],
  });
  assert.deepEqual(result, [first, nested, last]);
  assert.deepEqual(result.map((file) => file.webkitRelativePath), [
    "Project/first.txt", "Project/Notes/nested.txt", "Project/last.txt",
  ]);
});

test("captures ordinary files before the browser clears the drop event", async () => {
  const standalone = new File(["a"], "standalone.txt");
  const root = directory("Empty", []);
  const transfer = {
    items: [
      { kind: "file", webkitGetAsEntry: () => root, getAsFile: () => null },
      { kind: "file", getAsFile: () => standalone },
      { kind: "string", getAsFile: () => { throw new Error("Must ignore text items"); } },
    ],
    files: [standalone],
  };
  const pending = readDroppedFiles(transfer);
  transfer.items.length = 0;
  transfer.files.length = 0;
  assert.deepEqual(await pending, [standalone]);
});

test("supports a plain FileList and enforces total limits", async () => {
  const file = new File(["a"], "a.txt");
  assert.deepEqual(await readDroppedFiles({ files: [file] }), [file]);
  assert.equal((await readDroppedFiles({ files: Array(100).fill(file) })).length, 100);
  await assert.rejects(readDroppedFiles({ files: Array(101).fill(file) }), /100 datoteka/);
  const max = { name: "large.bin", size: 2 * 1024 * 1024 * 1024 };
  assert.deepEqual(await readDroppedFiles({ files: [max] }), [max]);
  await assert.rejects(readDroppedFiles({ files: [max, file] }), /2 GB/);
});

test("provides a useful error when a directory cannot be read", async () => {
  const root = {
    name: "Unavailable",
    isDirectory: true,
    createReader: () => ({ readEntries: (_resolve, reject) => reject(new Error("Denied")) }),
  };
  await assert.rejects(readDroppedFiles({
    items: [{ kind: "file", webkitGetAsEntry: () => root, getAsFile: () => null }],
    files: [],
  }), /Nije moguće pročitati „Unavailable”/);
});

test("only previews bounded raster images", () => {
  for (const type of ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp"])
    assert.equal(canPreview(new File(["image"], "image", { type })), true);
  for (const type of ["image/svg+xml", "text/html", "application/octet-stream", ""])
    assert.equal(canPreview(new File(["image"], "image.png", { type })), false);
  assert.equal(canPreview({ type: "image/png", size: 20 * 1024 * 1024 }), true);
  assert.equal(canPreview({ type: "image/png", size: 20 * 1024 * 1024 + 1 }), false);
});

test("uses Croatian file-count endings", () => {
  for (const count of [0, 1, 5, 11, 12, 13, 14, 21, 25, 111, 112, 113, 114])
    assert.equal(formatFileCount(count), `${count} datoteka`);
  for (const count of [2, 3, 4, 22, 23, 24, 102, 122])
    assert.equal(formatFileCount(count), `${count} datoteke`);
});
