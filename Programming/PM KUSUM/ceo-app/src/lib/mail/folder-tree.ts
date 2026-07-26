export type FolderLike = {
  id: string;
  path: string;
  name: string;
};

export type FolderTreeNode<T extends FolderLike = FolderLike> = {
  key: string;
  label: string;
  /** Set only if a real, selectable folder exists at exactly this path — a
   * pure grouping segment (e.g. "Clients" when only "Clients/Acme" exists)
   * has none and isn't clickable. */
  folder?: T;
  children: FolderTreeNode<T>[];
  depth: number;
};

/** Group flat label folders into a tree by their path delimiter (/ or .). */
export function buildFolderTree<T extends FolderLike>(
  folders: T[],
): FolderTreeNode<T>[] {
  const roots: FolderTreeNode<T>[] = [];
  const nodeByKey = new Map<string, FolderTreeNode<T>>();

  for (const f of folders) {
    const delim = f.path.includes("/") ? "/" : f.path.includes(".") ? "." : null;
    const segments = delim ? f.path.split(delim).filter(Boolean) : [f.name || f.path];
    let siblings = roots;
    let keyAcc = "";
    segments.forEach((seg, i) => {
      keyAcc = keyAcc ? `${keyAcc} ${seg}` : seg;
      let node = nodeByKey.get(keyAcc);
      if (!node) {
        node = { key: keyAcc, label: seg, children: [], depth: i };
        nodeByKey.set(keyAcc, node);
        siblings.push(node);
      }
      if (i === segments.length - 1) node.folder = f;
      siblings = node.children;
    });
  }
  return roots;
}
