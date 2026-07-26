import { describe, expect, it } from "vitest";
import { buildFolderTree, type FolderLike } from "@/lib/mail/folder-tree";

function folder(id: string, path: string): FolderLike {
  return { id, path, name: path.split(/[/.]/).pop() || path };
}

describe("buildFolderTree", () => {
  it("keeps flat (non-delimited) folders as separate root nodes", () => {
    const tree = buildFolderTree([folder("1", "Invoices"), folder("2", "Tech")]);
    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({ label: "Invoices", depth: 0, children: [] });
    expect(tree[0]!.folder!.id).toBe("1");
    expect(tree[1]!.folder!.id).toBe("2");
  });

  it("groups slash-delimited paths under a shared parent node", () => {
    const tree = buildFolderTree([
      folder("1", "Clients/Acme"),
      folder("2", "Clients/Beta"),
    ]);
    expect(tree).toHaveLength(1);
    const clients = tree[0]!;
    expect(clients.label).toBe("Clients");
    expect(clients.folder).toBeUndefined(); // pure grouping node, not itself a real folder
    expect(clients.children).toHaveLength(2);
    expect(clients.children.map((c) => c.label)).toEqual(["Acme", "Beta"]);
    expect(clients.children[0]!.depth).toBe(1);
  });

  it("attaches folder data to a parent node that is itself also a real folder", () => {
    const tree = buildFolderTree([
      folder("1", "Clients"),
      folder("2", "Clients/Acme"),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.folder!.id).toBe("1");
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.folder!.id).toBe("2");
  });

  it("supports dot-delimited IMAP hierarchy separators too", () => {
    const tree = buildFolderTree([folder("1", "Projects.PM-KUSUM")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.label).toBe("Projects");
    expect(tree[0]!.children[0]!.label).toBe("PM-KUSUM");
  });

  it("handles three levels of nesting", () => {
    const tree = buildFolderTree([folder("1", "A/B/C")]);
    expect(tree[0]!.label).toBe("A");
    expect(tree[0]!.children[0]!.label).toBe("B");
    expect(tree[0]!.children[0]!.children[0]!.label).toBe("C");
    expect(tree[0]!.children[0]!.children[0]!.depth).toBe(2);
    expect(tree[0]!.children[0]!.children[0]!.folder!.id).toBe("1");
  });
});
