import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api.ts";
import { count } from "../home/model.ts";
import { useLoad } from "../load.ts";
import { Failed, Screen } from "../screen.tsx";
import { type Glossary as GlossaryData, glossaryOf, type Term } from "../subject/glossary.ts";
import { tabPath } from "../subject/model.ts";

async function loadGlossary(id: string) {
  const [subject, unlocked] = await Promise.all([api.subject(id), api.unlocked(id)]);
  return { subject, glossary: glossaryOf(subject, unlocked.items, unlocked.today) };
}

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" />
  </svg>
);

export function Glossary() {
  const id = useParams().subject!;
  const loaded = useLoad(() => loadGlossary(id), [id], { refetchOn: ["content", "events"] });
  if (loaded.state !== "ready") {
    return (
      <Screen back={<BackLink subject={id} name={id} />} kicker={id} title="Glossary" state={loaded.state}>
        {loaded.state === "loading" ? <p className="tome-hint">Loading…</p> : <Failed error={loaded.error} />}
      </Screen>
    );
  }
  const { subject, glossary } = loaded.data;
  return (
    <Screen
      back={<BackLink subject={subject.id} name={subject.name} />}
      kicker={subject.name}
      title="Glossary"
      lede={`${count(glossary.items, "item")} from ${count(glossary.lessons, "lesson")}`}
    >
      <Terms glossary={glossary} />
    </Screen>
  );
}

function BackLink({ subject, name }: { subject: string; name: string }) {
  return (
    <Link className="tome-home-link" to={tabPath(subject, "reference")}>
      {name}
    </Link>
  );
}

function usePlayer() {
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  const [playing, setPlaying] = useState<string>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => () => audio.current?.pause(), []);
  async function play(term: Term) {
    if (term.audio === undefined) return;
    audio.current?.pause();
    const sound = new Audio(term.audio);
    audio.current = sound;
    sound.onended = () => setPlaying((current) => (current === term.id ? undefined : current));
    setPlaying(term.id);
    try {
      await sound.play();
      if (audio.current === sound) setNotice(undefined);
    } catch (error) {
      if (audio.current !== sound) return;
      setPlaying((current) => (current === term.id ? undefined : current));
      setNotice(`Couldn't play the sound: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { playing, notice, play };
}

function Terms({ glossary }: { glossary: GlossaryData }) {
  const player = usePlayer();
  if (glossary.groups.length === 0) {
    return (
      <div className="tome-glossary">
        <p className="tome-hint">Nothing unlocked yet. Finish a lesson to fill your glossary.</p>
      </div>
    );
  }
  return (
    <>
      {player.notice && (
        <p className="tome-notice" role="alert">
          {player.notice}
        </p>
      )}
      <div className="tome-glossary">
        {glossary.groups.map((group) => {
          const heading = (
            <>
              {group.name.number !== undefined && <span className="tome-num">{group.name.number}</span>}
              {group.name.title}
            </>
          );
          return (
            <section key={group.lesson ?? ""} className="tome-section" data-lesson={group.lesson}>
              <div className="tome-section-head">
                <h3>{group.href ? <a href={group.href}>{heading}</a> : heading}</h3>
                <span className="tome-meta">{count(group.terms.length, "item")}</span>
              </div>
              <ul className="tome-terms">
                {group.terms.map((term) => (
                  <li key={term.id} className="tome-term" data-item={term.id}>
                    <span className="tome-term-word">{term.word}</span>
                    <span className="tome-term-when" data-due={term.due ? "" : undefined}>
                      {term.when}
                    </span>
                    {term.audio !== undefined && (
                      <button
                        className="tome-hear"
                        type="button"
                        aria-label={`Hear ${term.word}`}
                        data-playing={player.playing === term.id ? "" : undefined}
                        onClick={() => void player.play(term)}
                      >
                        {PLAY_ICON}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
