import { useEffect, useState } from "react";

// Empty string = same-origin requests. Nginx proxies /api/* to the backend
// container in prod; Vite's dev server proxies the same path in dev.
const API_URL = import.meta.env.VITE_API_URL || "";

export default function App() {
  const [notes, setNotes] = useState([]);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("checking…");
  const [error, setError] = useState(null);

  async function loadNotes() {
    try {
      const res = await fetch(`${API_URL}/api/notes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNotes(await res.json());
      setError(null);
    } catch (e) {
      setError(`Could not reach backend at ${API_URL}: ${e.message}`);
    }
  }

  async function checkHealth() {
    try {
      const res = await fetch(`${API_URL}/api/health`);
      const body = await res.json();
      setStatus(`${body.status} (uptime ${Math.round(body.uptime)}s)`);
    } catch {
      setStatus("offline");
    }
  }

  useEffect(() => {
    checkHealth();
    loadNotes();
    const t = setInterval(checkHealth, 5000);
    return () => clearInterval(t);
  }, []);

  async function addNote(e) {
    e.preventDefault();
    if (!text.trim()) return;
    const res = await fetch(`${API_URL}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      setText("");
      loadNotes();
    }
  }

  async function deleteNote(id) {
    await fetch(`${API_URL}/api/notes/${id}`, { method: "DELETE" });
    loadNotes();
  }

  return (
    <main className="page">
      <header>
        <h1>Cloud Notes</h1>
        <p className="subtitle">
          React frontend talking to an Express backend — both running in Docker.
        </p>
        <p className="status">
          Backend: <strong>{status}</strong>
        </p>
      </header>

      <form onSubmit={addNote} className="composer">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a note…"
          aria-label="Note text"
        />
        <button type="submit" disabled={!text.trim()}>
          Add note
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      <ul className="notes">
        {notes.length === 0 && !error && (
          <li className="empty">No notes yet — add the first one above.</li>
        )}
        {notes.map((n) => (
          <li key={n.id} className="note">
            <div>
              <p>{n.text}</p>
              <time>{new Date(n.createdAt).toLocaleString()}</time>
            </div>
            <button
              type="button"
              onClick={() => deleteNote(n.id)}
              aria-label={`Delete note ${n.id}`}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <footer>
        <small>API: {API_URL}</small>
      </footer>
    </main>
  );
}
