// SigilMarkets/SigilHowTo.tsx
"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "./ui/atoms/Button";
import { Divider } from "./ui/atoms/Divider";
import { Icon } from "./ui/atoms/Icon";
import { Sheet } from "./ui/atoms/Sheet";
import { decodeBoolean, loadFromStorage, saveToStorage, SM_HOWTO_DISMISSED_KEY } from "./state/persistence";

export const SigilHowTo = () => {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const toggleId = useId();

  useEffect(() => {
    const res = loadFromStorage(SM_HOWTO_DISMISSED_KEY, decodeBoolean);
    if (res.ok && res.value === true) {
      setDismissed(true);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      closeRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const showTrigger = useMemo(() => (hydrated ? !dismissed : true), [dismissed, hydrated]);

  const setDismissedPersisted = (next: boolean): void => {
    setDismissed(next);
    saveToStorage(SM_HOWTO_DISMISSED_KEY, next);
  };

  const close = (): void => setOpen(false);

  return (
    <>
      {showTrigger ? (
        <div className="vhHowToDock" aria-hidden={open}>
          <button
            type="button"
            className="vhHowToButton"
            onClick={() => setOpen(true)}
            aria-label="How to learn about Sigil-Glyphs"
          >
            <span className="vhHowToButtonLabel">How to</span>
            <Icon name="spark" size={12} tone="dim" className="vhHowToButtonIcon" />
          </button>
        </div>
      ) : null}

      <Sheet
        open={open}
        onClose={close}
        title="Sigil-Glyphs"
        subtitle="Portable proof you can share."
        className="vhHowToSheet"
        footer={
          <div className="vhHowToFooter">
            <Button ref={closeRef} variant="primary" size="md" onClick={close} aria-label="Close how to">
              Got it
            </Button>
          </div>
        }
      >
        <div className="vhHowToContent">
          <section className="vhHowToSection">
            <h3>What is a Sigil-Glyph?</h3>
            <p>
              A Sigil-Glyph is a shareable symbol that carries verifiable data inside the SVG—so the image isn’t just art,
              it’s proof.
            </p>
          </section>

          <section className="vhHowToSection">
            <h3>What does Verahai do?</h3>
            <p>
              Verahai lets you mint, share, and verify Sigil-Glyphs for real claims—so truth can move peer-to-peer, not
              platform-to-platform.
            </p>
          </section>

          <Divider className="vhHowToDivider" />

          <div className="vhHowToSteps">
            <ul>
              <li>Mint: create a sigil for a moment / claim</li>
              <li>Share: send the SVG anywhere</li>
              <li>Verify: confirm the embedded proof + metadata</li>
            </ul>
            <p className="vhHowToNote">Verification reads the SVG’s embedded metadata—no trust required.</p>
          </div>

          <label className="vhHowToToggle" htmlFor={toggleId}>
            <input
              id={toggleId}
              type="checkbox"
              checked={dismissed}
              onChange={(event) => setDismissedPersisted(event.target.checked)}
            />
            <span>Don’t show this again</span>
          </label>
        </div>
      </Sheet>
    </>
  );
};
