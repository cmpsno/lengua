/**
 * lengua web client.
 *
 * Mic path (spec §6): getUserMedia -> AudioContext -> AudioWorklet
 * (16-bit PCM @ 16 kHz) -> WebSocket binary frames -> backend STT adapter.
 *
 * NOTE (iPad Safari): getUserMedia requires a secure context. On the LAN this
 * means serving the backend over HTTPS (self-signed cert or a tunnel like
 * ngrok/Cloudflare) — plain http://<lan-ip> will refuse mic access.
 */

type Mode = "grandma" | "me";

interface ServerMsg {
  type: string;
  [k: string]: unknown;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

let ws: WebSocket | null = null;
let mode: Mode | null = null;
let sessionActive = false;
let liveTurnEl: HTMLElement | null = null;
let liveTurnId: string | null = null;
let micStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let workletNode: AudioWorkletNode | null = null;

function setStatus(s: string): void {
  $("status").textContent = s;
}

function send(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/* ---------------- conversation rendering ---------------- */

function scrollBottom(): void {
  const c = $("conversation");
  c.scrollTop = c.scrollHeight;
}

function ensureLiveTurn(who: Mode, turnId: string): HTMLElement {
  if (liveTurnEl && liveTurnId === turnId) return liveTurnEl;
  const el = document.createElement("div");
  el.className = `turn live ${who}`;
  el.innerHTML = `<div class="who"></div><div class="text"></div><div class="translation"></div>`;
  (el.querySelector(".who") as HTMLElement).textContent = who === "grandma" ? "Grandma" : "Me";
  $("conversation").appendChild(el);
  liveTurnEl = el;
  liveTurnId = turnId;
  return el;
}

function settleTurn(): void {
  if (liveTurnEl) liveTurnEl.classList.remove("live");
  liveTurnEl = null;
  liveTurnId = null;
}

function renderTurn(turn: { id: string; speaker: Mode; text: string; translation?: string }): void {
  settleTurn();
  const el = document.createElement("div");
  el.className = `turn ${turn.speaker}`;
  el.innerHTML = `<div class="who"></div><div class="text"></div><div class="translation"></div>`;
  (el.querySelector(".who") as HTMLElement).textContent = turn.speaker === "grandma" ? "Grandma" : "Me";
  (el.querySelector(".text") as HTMLElement).textContent = turn.text;
  if (turn.translation) (el.querySelector(".translation") as HTMLElement).textContent = turn.translation;
  $("conversation").appendChild(el);
  scrollBottom();
}

/* ---------------- suggestion tray ---------------- */

interface Chip {
  spanish: string;
  english: string;
  stuck?: boolean;
}

function renderChips(chips: Chip[]): void {
  const box = $("chips");
  box.innerHTML = "";
  for (const c of chips) {
    const b = document.createElement("button");
    b.className = "chip" + (c.stuck ? " stuck-chip" : "");
    b.innerHTML = `<div class="es"></div><div class="gloss"></div>`;
    (b.querySelector(".es") as HTMLElement).textContent = c.spanish;
    (b.querySelector(".gloss") as HTMLElement).textContent = c.english;
    b.addEventListener("click", () => b.classList.toggle("open"));
    box.appendChild(b);
  }
  $("tray-title").textContent = chips.length ? (chips[0].stuck ? "stuck — tap a word" : "how to start your reply") : "suggestions";
}

/* ---------------- review panel ---------------- */

function renderReview(r: {
  issues: Array<{ original: string; corrected: string; explanation: string; severity: string; possible_transcription_error: boolean }>;
  natural_version: string;
  encouragement: string | null;
}): void {
  const panel = $("review-panel");
  const body = $("review-body");
  panel.hidden = false;
  body.innerHTML = "";
  if (r.issues.length === 0) {
    body.innerHTML = "<p>¡Perfecto! No corrections this time.</p>";
  }
  for (const i of r.issues) {
    const d = document.createElement("div");
    d.className = "issue";
    d.innerHTML = `<div><span class="sev"></span> <span class="orig"></span> → <span class="corr"></span></div><div class="expl"></div>`;
    (d.querySelector(".sev") as HTMLElement).textContent = (i.possible_transcription_error ? "maybe misheard · " : "") + i.severity;
    (d.querySelector(".orig") as HTMLElement).textContent = i.original;
    (d.querySelector(".corr") as HTMLElement).textContent = i.corrected;
    (d.querySelector(".expl") as HTMLElement).textContent = i.explanation;
    body.appendChild(d);
  }
  const nat = document.createElement("div");
  nat.className = "natural";
  nat.textContent = "Natural version: " + r.natural_version;
  body.appendChild(nat);
  if (r.encouragement) {
    const e = document.createElement("p");
    e.textContent = r.encouragement;
    body.appendChild(e);
  }
}

/* ---------------- mic capture ---------------- */

async function startMic(): Promise<void> {
  if (micStream) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (e) {
    setStatus("mic blocked — needs HTTPS (or localhost)");
    throw e;
  }
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule("/worklet.js");
  micSource = audioCtx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm16-worklet");
  workletNode.port.onmessage = (ev: MessageEvent) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(ev.data as ArrayBuffer);
  };
  micSource.connect(workletNode);
  // Worklet must connect somewhere to run; a zero-gain node keeps it silent.
  const sink = audioCtx.createGain();
  sink.gain.value = 0;
  workletNode.connect(sink);
  sink.connect(audioCtx.destination);
  if (audioCtx.state === "suspended") await audioCtx.resume();
}

function stopMic(): void {
  workletNode?.disconnect();
  micSource?.disconnect();
  void audioCtx?.close();
  micStream?.getTracks().forEach((t) => t.stop());
  workletNode = null;
  micSource = null;
  audioCtx = null;
  micStream = null;
}

/* ---------------- websocket ---------------- */

function connect(): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => setStatus("connected");
  ws.onclose = () => {
    setStatus("disconnected — retrying…");
    setTimeout(connect, 2000);
  };
  ws.onerror = () => setStatus("connection error");

  ws.onmessage = (ev: MessageEvent) => {
    const msg = JSON.parse(ev.data as string) as ServerMsg;
    switch (msg.type) {
      case "interim": {
        const el = ensureLiveTurn(mode ?? "grandma", msg.turnId as string);
        (el.querySelector(".text") as HTMLElement).textContent = msg.text as string;
        scrollBottom();
        break;
      }
      case "final": {
        const el = ensureLiveTurn(mode ?? "grandma", msg.turnId as string);
        (el.querySelector(".text") as HTMLElement).textContent = msg.text as string;
        scrollBottom();
        break;
      }
      case "translation": {
        if (liveTurnEl && liveTurnId === (msg.turnId as string)) {
          (liveTurnEl.querySelector(".translation") as HTMLElement).textContent = msg.english as string;
        }
        break;
      }
      case "turn": {
        const t = msg.turn as { id: string; speaker: Mode; text: string; translation?: string };
        renderTurn(t);
        if (t.speaker === "grandma") $("review-panel").hidden = true;
        break;
      }
      case "turn_reset":
        settleTurn();
        break;
      case "openers": {
        const ops = msg.openers as Array<{ spanish: string; english: string }>;
        renderChips(ops.map((o) => ({ spanish: o.spanish, english: o.english })));
        break;
      }
      case "candidates": {
        const c = msg.candidates as Array<{ spanish: string; english: string; note?: string | null }>;
        renderChips(c.map((x) => ({ spanish: x.spanish, english: x.english + (x.note ? ` — ${x.note}` : ""), stuck: true })));
        break;
      }
      case "review":
        renderReview(msg.review as Parameters<typeof renderReview>[0]);
        break;
      case "end_of_speech":
        break;
      case "mode":
        setStatus(`${msg.mode} · ${(msg.provider as string) ?? ""}`);
        break;
      case "error":
        setStatus(`error (${msg.where}): ${msg.message}`);
        break;
    }
  };
}

/* ---------------- controls ---------------- */

function setMode(next: Mode): void {
  mode = next;
  $("btn-grandma").classList.toggle("active", next === "grandma");
  $("btn-me").classList.toggle("active", next === "me");
  send({ type: "switch" });
  const consent = ($("consent-check") as HTMLInputElement).checked;
  send({ type: "start", mode: next, consent });
  settleTurn();
  void startMic().catch(() => {});
}

function wire(): void {
  $("btn-grandma").addEventListener("click", () => setMode("grandma"));
  $("btn-me").addEventListener("click", () => setMode("me"));

  $("btn-stuck").addEventListener("click", () => {
    // Sends the current partial turn text; the server fills context.
    const partial = liveTurnEl ? (liveTurnEl.querySelector(".text") as HTMLElement).textContent ?? "" : "";
    send({ type: "stuck", partial });
  });

  $("btn-done").addEventListener("click", () => send({ type: "done" }));

  $("btn-session").addEventListener("click", () => {
    if (!sessionActive) {
      sessionActive = true;
      $("consent").hidden = false;
      ($("btn-session") as HTMLButtonElement).textContent = "End session";
      $("btn-save").removeAttribute("disabled");
      $("btn-delete").removeAttribute("disabled");
      setStatus("session started");
    } else {
      sessionActive = false;
      $("consent").hidden = true;
      ($("btn-session") as HTMLButtonElement).textContent = "Start session";
      stopMic();
      send({ type: "switch" });
      mode = null;
      $("btn-grandma").classList.remove("active");
      $("btn-me").classList.remove("active");
      settleTurn();
      setStatus("session ended");
    }
  });

  $("btn-save").addEventListener("click", async () => {
    const res = await fetch("/api/session/save", { method: "POST" });
    const j = await res.json();
    setStatus(res.ok ? `saved: ${j.saved}` : "save failed");
  });

  $("btn-delete").addEventListener("click", async () => {
    if (!confirm("Delete the whole session (transcripts + log)? This cannot be undone.")) return;
    const res = await fetch("/api/session", { method: "DELETE" });
    if (res.ok) {
      $("conversation").innerHTML = "";
      $("chips").innerHTML = "";
      $("review-panel").hidden = true;
      setStatus("session deleted");
    }
  });

  $("review-toggle").addEventListener("click", () => {
    const body = $("review-body");
    const hidden = body.style.display === "none";
    body.style.display = hidden ? "" : "none";
    ($("review-toggle") as HTMLButtonElement).textContent = hidden ? "review ▾" : "review ▸";
  });
}

wire();
connect();
