import { createContext, useCallback, useContext, useRef, useState, PropsWithChildren } from "react";
import { useLanguage } from "../lib/i18n";
import { ChoiceDialog } from "../components/ChoiceDialog";

type AddToListChoice = "add" | "skip";

interface AddToListPromptContextValue {
  askAddToList: (showName: string) => Promise<AddToListChoice>;
}

const AddToListPromptContext = createContext<AddToListPromptContextValue | null>(null);

export function AddToListPromptProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(false);
  const [showName, setShowName] = useState("");
  const resolver = useRef<((choice: AddToListChoice) => void) | null>(null);
  const { t } = useLanguage();

  const askAddToList = useCallback((name: string) => {
    return new Promise<AddToListChoice>((resolve) => {
      // Only one dialog can be on screen at a time — same reasoning as
      // RewatchPromptContext/PreviousEpisodesPromptContext.
      resolver.current?.("skip");
      resolver.current = resolve;
      setShowName(name);
      setVisible(true);
    });
  }, []);

  function choose(choice: AddToListChoice) {
    setVisible(false);
    resolver.current?.(choice);
    resolver.current = null;
  }

  return (
    <AddToListPromptContext.Provider value={{ askAddToList }}>
      {children}
      <ChoiceDialog
        visible={visible}
        title={t.addToListPrompt.title}
        subtitle={t.addToListPrompt.subtitle(showName)}
        options={[
          { value: "skip", label: t.addToListPrompt.skip },
          { value: "add", label: t.addToListPrompt.add, primary: true },
        ]}
        onChoose={choose}
        onDismiss={() => choose("skip")}
      />
    </AddToListPromptContext.Provider>
  );
}

export function useAddToListPrompt() {
  const ctx = useContext(AddToListPromptContext);
  if (!ctx) throw new Error("useAddToListPrompt must be used within AddToListPromptProvider");
  return ctx.askAddToList;
}
