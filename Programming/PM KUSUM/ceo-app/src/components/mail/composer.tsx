"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Blockquote from "@tiptap/extension-blockquote";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle, FontFamily, FontSize } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TableKit } from "@tiptap/extension-table";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { haptic } from "@/components/mail/haptics";

/**
 * Quoted reply history (and forwarded messages) land in the document as a
 * real <blockquote> so the full content still goes out with the sent mail —
 * but showing it expanded by default buries the new text under someone
 * else's entire message.
 *
 * The collapsed/expanded flag is a genuine ProseMirror node attribute (not
 * NodeView-local DOM/closure state) deliberately: ProseMirror recreates
 * NodeViews far more often than it seems like it should (cursor moves,
 * decoration recalculation, unrelated transactions elsewhere in the doc),
 * and a NodeView has no durable memory of its own across that churn — only
 * the document model does. `renderHTML` deliberately drops the attribute,
 * so it's purely an editing-UI concern and never leaks into the sent HTML.
 */
const CollapsibleBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      collapsed: {
        default: false,
        // Content freshly toggled on via the toolbar's Quote button has no
        // HTML to parse and gets the plain `default` above (expanded, so
        // the user can see what they're typing). Content loaded from a
        // reply/forward *is* parsed HTML — collapse it only if it actually
        // carries real quoted text.
        parseHTML: (element: HTMLElement) =>
          (element.textContent || "").trim().length > 0,
        renderHTML: () => ({}),
      },
    };
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "mail-quote-node";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.contentEditable = "false";
      toggle.textContent = "•••";
      toggle.style.cssText =
        "cursor:pointer;border:none;background:rgba(255,255,255,0.06);" +
        "color:var(--text-dim,#9aa);border-radius:999px;padding:2px 10px;" +
        "font-size:12px;line-height:1.6;margin-bottom:4px;display:inline-block;";

      const content = document.createElement("blockquote");

      function render(collapsed: boolean) {
        content.style.display = collapsed ? "none" : "";
        toggle.title = collapsed ? "Show trimmed content" : "Hide trimmed content";
      }
      render(Boolean(node.attrs.collapsed));

      toggle.addEventListener("mousedown", (e) => e.preventDefault());
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = getPos();
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current) return;
        editor.view.dispatch(
          editor.state.tr.setNodeAttribute(pos, "collapsed", !current.attrs.collapsed),
        );
      });

      wrapper.appendChild(toggle);
      wrapper.appendChild(content);

      return {
        dom: wrapper,
        contentDOM: content,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false;
          render(Boolean(updatedNode.attrs.collapsed));
          return true;
        },
        // The toggle button lives outside contentDOM, so ProseMirror's
        // MutationObserver would otherwise see its title/style mutations as
        // unexpected external drift. Ignore mutations to our own chrome
        // only — anything inside contentDOM (actual quoted-text edits)
        // still needs to reach ProseMirror normally.
        ignoreMutation: (mutation: { target: EventTarget | null }) =>
          !content.contains(mutation.target as Node),
      };
    };
  },
});

type Tool =
  | { type: "btn"; id: string; label: string; title: string; active?: boolean; run: () => void }
  | { type: "sep" };

export function MailComposer({
  initialHtml,
  onChange,
  placeholder = "Write your message…",
  minHeight = 280,
  onFullscreen,
  fullscreenActive = false,
  fillViewport = false,
}: {
  initialHtml?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  onFullscreen?: () => void;
  fullscreenActive?: boolean;
  fillViewport?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: false,
      }),
      CollapsibleBlockquote,
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      TableKit.configure({
        table: { resizable: true },
      }),
    ],
    content: initialHtml || "",
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => onChange?.(ed.getHTML()),
    editorProps: {
      attributes: {
        class: fillViewport
          ? "mail-composer-prose mail-composer-prose--fill"
          : "mail-composer-prose",
        ...(fillViewport ? {} : { style: `min-height:${minHeight}px` }),
      },
    },
  });

  useEffect(() => {
    if (editor && initialHtml != null && initialHtml !== editor.getHTML()) {
      editor.commands.setContent(initialHtml, { emitUpdate: false });
    }
  }, [initialHtml, editor]);

  if (!editor) {
    return (
      <div
        className="animate-pulse rounded-xl"
        style={{
          height: minHeight + 64,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
        }}
      />
    );
  }

  const tools: Tool[] = [
    {
      type: "btn",
      id: "h1",
      label: "H1",
      title: "Heading 1",
      active: editor.isActive("heading", { level: 1 }),
      run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      type: "btn",
      id: "h2",
      label: "H2",
      title: "Heading 2",
      active: editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      type: "btn",
      id: "h3",
      label: "H3",
      title: "Heading 3",
      active: editor.isActive("heading", { level: 3 }),
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    { type: "sep" },
    {
      type: "btn",
      id: "bold",
      label: "B",
      title: "Bold",
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      type: "btn",
      id: "italic",
      label: "I",
      title: "Italic",
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      type: "btn",
      id: "underline",
      label: "U",
      title: "Underline",
      active: editor.isActive("underline"),
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      type: "btn",
      id: "strike",
      label: "S",
      title: "Strikethrough",
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      type: "btn",
      id: "highlight",
      label: "HL",
      title: "Highlight",
      active: editor.isActive("highlight"),
      run: () => editor.chain().focus().toggleHighlight().run(),
    },
    { type: "sep" },
    {
      type: "btn",
      id: "bullet",
      label: "• List",
      title: "Bullet list",
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      type: "btn",
      id: "ordered",
      label: "1. List",
      title: "Numbered list",
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      type: "btn",
      id: "quote",
      label: "Quote",
      title: "Blockquote",
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      type: "btn",
      id: "code",
      label: "</>",
      title: "Code block",
      active: editor.isActive("codeBlock"),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      type: "btn",
      id: "hr",
      label: "—",
      title: "Horizontal rule",
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
    { type: "sep" },
    {
      type: "btn",
      id: "left",
      label: "⟸",
      title: "Align left",
      active: editor.isActive({ textAlign: "left" }),
      run: () => editor.chain().focus().setTextAlign("left").run(),
    },
    {
      type: "btn",
      id: "center",
      label: "☰",
      title: "Align center",
      active: editor.isActive({ textAlign: "center" }),
      run: () => editor.chain().focus().setTextAlign("center").run(),
    },
    {
      type: "btn",
      id: "right",
      label: "⟹",
      title: "Align right",
      active: editor.isActive({ textAlign: "right" }),
      run: () => editor.chain().focus().setTextAlign("right").run(),
    },
    { type: "sep" },
    {
      type: "btn",
      id: "link",
      label: "Link",
      title: "Insert / edit link",
      active: editor.isActive("link"),
      run: () => {
        const prev = editor.getAttributes("link").href as string | undefined;
        const url = window.prompt("Link URL", prev || "https://");
        if (url === null) return;
        if (url === "") {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          return;
        }
        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
      },
    },
    {
      type: "btn",
      id: "table",
      label: "Table",
      title: "Insert 3×3 table",
      active: editor.isActive("table"),
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      type: "btn",
      id: "col+",
      label: "+Col",
      title: "Add column after",
      run: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      type: "btn",
      id: "row+",
      label: "+Row",
      title: "Add row after",
      run: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      type: "btn",
      id: "del-table",
      label: "⌫ Table",
      title: "Delete table",
      run: () => editor.chain().focus().deleteTable().run(),
    },
    { type: "sep" },
    {
      type: "btn",
      id: "undo",
      label: "Undo",
      title: "Undo",
      run: () => editor.chain().focus().undo().run(),
    },
    {
      type: "btn",
      id: "redo",
      label: "Redo",
      title: "Redo",
      run: () => editor.chain().focus().redo().run(),
    },
    {
      type: "btn",
      id: "clear",
      label: "Clear",
      title: "Clear formatting",
      run: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
    },
  ];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`overflow-hidden rounded-xl ${fillViewport ? "flex h-full min-h-0 flex-col" : ""}`}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.28)",
        height: fillViewport ? "100%" : undefined,
      }}
    >
      <div
        className="flex flex-wrap items-center gap-1 px-2 py-2"
        style={{
          borderBottom: "1px solid var(--border)",
          background: "rgba(0,0,0,0.22)",
        }}
      >
        {/* Font family + size — Gmail-style; default is Sans Serif 14px */}
        <select
          title="Font"
          className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] outline-none"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            maxWidth: 96,
          }}
          value={
            (editor.getAttributes("textStyle").fontFamily as string) || ""
          }
          onChange={(e) => {
            haptic("tap");
            const v = e.target.value;
            if (v) editor.chain().focus().setFontFamily(v).run();
            else editor.chain().focus().unsetFontFamily().run();
          }}
        >
          <option value="">Sans Serif</option>
          <option value="Georgia, 'Times New Roman', serif">Serif</option>
          <option value="'Courier New', monospace">Mono</option>
          <option value="Verdana, sans-serif">Verdana</option>
        </select>
        <select
          title="Text size"
          className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] outline-none"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
          }}
          value={(editor.getAttributes("textStyle").fontSize as string) || ""}
          onChange={(e) => {
            haptic("tap");
            const v = e.target.value;
            if (v) editor.chain().focus().setFontSize(v).run();
            else editor.chain().focus().unsetFontSize().run();
          }}
        >
          <option value="">Normal</option>
          <option value="12px">Small</option>
          <option value="16px">Large</option>
          <option value="18px">Larger</option>
          <option value="24px">Huge</option>
        </select>
        <span
          className="mx-0.5 h-5 w-px"
          style={{ background: "var(--border-strong)" }}
        />
        {tools.map((t, i) =>
          t.type === "sep" ? (
            <span
              key={`sep-${i}`}
              className="mx-0.5 h-5 w-px"
              style={{ background: "var(--border-strong)" }}
            />
          ) : (
            <motion.button
              key={t.id}
              type="button"
              title={t.title}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                haptic("tap");
                t.run();
              }}
              className="cursor-pointer rounded-md px-2 py-1.5 text-[11px] font-semibold tracking-wide"
              style={{
                minWidth: 28,
                background: t.active ? "var(--accent-dim)" : "transparent",
                color: t.active ? "var(--accent-bright)" : "var(--text-muted)",
                border: t.active
                  ? "1px solid rgba(99,102,241,0.4)"
                  : "1px solid transparent",
                fontStyle: t.id === "italic" ? "italic" : undefined,
                textDecoration:
                  t.id === "underline"
                    ? "underline"
                    : t.id === "strike"
                      ? "line-through"
                      : undefined,
              }}
            >
              {t.label}
            </motion.button>
          ),
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {onFullscreen && (
            <motion.button
              type="button"
              title={fullscreenActive ? "Exit fullscreen" : "Open fullscreen editor"}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => {
                haptic("tap");
                onFullscreen();
              }}
              className="mail-cta-primary cursor-pointer rounded-full px-3 py-1.5 text-[11px] font-semibold"
              style={{ color: "#fff" }}
            >
              {fullscreenActive ? "Exit ↗" : "Fullscreen ↗"}
            </motion.button>
          )}
          <label
            className="flex items-center gap-1.5 text-[11px]"
            style={{ color: "var(--text-dim)" }}
            title="Text color"
          >
            Color
            <input
              type="color"
              defaultValue="#e8ecf6"
              className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent"
              onChange={(e) => {
                editor.chain().focus().setColor(e.target.value).run();
                haptic("tap");
              }}
            />
          </label>
        </div>
      </div>
      <div className={`px-1 py-1 ${fillViewport ? "min-h-0 flex-1 overflow-auto" : ""}`}>
        <EditorContent editor={editor} />
      </div>
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 text-[10px]"
        style={{ borderTop: "1px solid var(--border)", color: "var(--text-dim)" }}
      >
        <span>Rich HTML · tables · lists · headings · alignment · color</span>
        {onFullscreen && !fullscreenActive && (
          <button
            type="button"
            className="cursor-pointer font-semibold"
            style={{ color: "var(--accent-bright)" }}
            onClick={() => {
              haptic("tap");
              onFullscreen();
            }}
          >
            Expand editor →
          </button>
        )}
      </div>
    </motion.div>
  );
}
