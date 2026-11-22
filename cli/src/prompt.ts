import { createInterface } from "node:readline";

export interface PromptStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  terminal: boolean;
}

export class PromptCancelled extends Error {
  constructor() {
    super("Cancelled");
  }
}

export interface Prompter {
  ask(question: string, fallback?: string): Promise<string>;
  say(line: string): void;
  close(): void;
}

export function createPrompter({ input, output, terminal }: PromptStreams): Prompter {
  const rl = createInterface({ input, output, terminal });
  const lines: string[] = [];
  let waiting: { resolve: (line: string) => void; reject: (error: Error) => void } | undefined;
  let closed = false;

  rl.on("line", (line) => {
    if (waiting) {
      const { resolve } = waiting;
      waiting = undefined;
      resolve(line);
    } else {
      lines.push(line);
    }
  });
  rl.on("SIGINT", () => rl.close());
  rl.on("close", () => {
    closed = true;
    waiting?.reject(new PromptCancelled());
    waiting = undefined;
  });

  return {
    async ask(question, fallback) {
      const text = fallback ? `${question} [${fallback}]: ` : `${question}: `;
      if (closed) {
        output.write(text);
      } else {
        rl.setPrompt(text);
        rl.prompt();
      }
      const queued = lines.shift();
      let answer: string;
      if (queued !== undefined) {
        answer = queued;
      } else {
        if (closed) throw new PromptCancelled();
        answer = await new Promise<string>((resolve, reject) => {
          waiting = { resolve, reject };
        });
      }
      answer = answer.trim();
      return answer === "" && fallback !== undefined ? fallback : answer;
    },
    say(line) {
      output.write(`${line}\n`);
    },
    close() {
      rl.close();
    },
  };
}
