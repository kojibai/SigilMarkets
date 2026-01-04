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
  const [activeStep, setActiveStep] = useState(0);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
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

  useEffect(() => {
    if (!open) return;
    setActiveStep(0);
    if (carouselRef.current) {
      carouselRef.current.scrollTo({ left: 0 });
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const showTrigger = useMemo(() => (hydrated ? !dismissed : true), [dismissed, hydrated]);

  const setDismissedPersisted = (next: boolean): void => {
    setDismissed(next);
    saveToStorage(SM_HOWTO_DISMISSED_KEY, next);
  };

  const close = (): void => setOpen(false);

  const steps = useMemo(
    () => [
      {
        title: "What is a Sigil-Glyph?",
        body: "A Sigil-Glyph is a shareable symbol that carries verifiable data inside the SVG—so the image isn’t just art, it’s proof.",
      },
      {
        title: "What does Verahai do?",
        body: "Verahai lets you mint, share, and verify Sigil-Glyphs for real claims—so truth can move peer-to-peer, not platform-to-platform.",
      },
      {
        title: "How it works",
        body: null,
        bullets: [
          "Mint: create a sigil for a moment / claim",
          "Share: send the SVG anywhere",
          "Verify: confirm the embedded proof + metadata",
        ],
        note: "Verification reads the SVG’s embedded metadata—no trust required.",
      },
    ],
    [],
  );

  const updateActiveStep = (): void => {
    if (!carouselRef.current) return;
    const el = carouselRef.current;
    const stepWidth = el.clientWidth;
    if (stepWidth <= 0) return;
    const nextIndex = Math.round(el.scrollLeft / stepWidth);
    setActiveStep(Math.max(0, Math.min(steps.length - 1, nextIndex)));
  };

  const onCarouselScroll = (): void => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(updateActiveStep);
  };

  const jumpTo = (index: number): void => {
    const el = carouselRef.current;
    if (!el) return;
    const target = Math.max(0, Math.min(steps.length - 1, index));
    el.scrollTo({ left: el.clientWidth * target, behavior: "smooth" });
    setActiveStep(target);
  };

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
          <div className="vhHowToCarousel" ref={carouselRef} onScroll={onCarouselScroll}>
            {steps.map((step, index) => (
              <section key={step.title} className="vhHowToSlide" aria-label={`Step ${index + 1} of ${steps.length}`}>
                <div className="vhHowToSlideTop">
                  <span className="vhHowToStepBadge">Step {index + 1}</span>
                  <span className="vhHowToStepCount">
                    {index + 1} / {steps.length}
                  </span>
                </div>
                <h3>{step.title}</h3>
                {step.body ? <p>{step.body}</p> : null}
                {step.bullets ? (
                  <div className="vhHowToSteps">
                    <ul>
                      {step.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                    {step.note ? <p className="vhHowToNote">{step.note}</p> : null}
                  </div>
                ) : null}
              </section>
            ))}
          </div>

          <div className="vhHowToDots" role="tablist" aria-label="How to steps">
            {steps.map((_, index) => (
              <button
                key={`dot-${index}`}
                type="button"
                className={`vhHowToDot ${index === activeStep ? "is-active" : ""}`}
                aria-label={`Go to step ${index + 1}`}
                aria-selected={index === activeStep}
                onClick={() => jumpTo(index)}
              />
            ))}
          </div>

          <Divider className="vhHowToDivider" />

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
