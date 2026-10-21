"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

export interface LibraryImage {
  src: string;
  url: string;
  alt: string;
}

interface EditorState {
  /** Version of the saved template; every save sends it and gets the new one back. */
  version: string | null;
  setVersion: (v: string | null) => void;
  /** Pictures shipped with the app, offered in "Choose from library" next to uploads. */
  builtIn: LibraryImage[];
}

const Ctx = createContext<EditorState | null>(null);

export function useEditor() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useEditor must be used inside ProposalEditorProvider");
  return s;
}

export function ProposalEditorProvider({ version: initial, builtIn, children }: { version: string | null; builtIn: LibraryImage[]; children: ReactNode }) {
  const [version, setVersion] = useState(initial);
  return <Ctx.Provider value={{ version, setVersion, builtIn }}>{children}</Ctx.Provider>;
}
