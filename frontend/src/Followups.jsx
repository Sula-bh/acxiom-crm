import { useEffect, useState } from "react";
import api from "./api";

const initialForm = {
  customer_id: "",
  lead_id: "",
  followup_date: "",
  followup_type: "Call",
  subject: "",
  remarks: "",
  status: "Planned",
};

export default function Followups() {
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");

  async function loadData() {
    try {
      const [f, c, l] = await Promise.all([
        api.get("/followups"),
        api.get("/customers"),
        api.get("/leads"),
      ]);
      setItems(f.data);
      setCustomers(c.data);
      setLeads(l.data);
    } catch {
      setError("Unable to load follow-ups.");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function change(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function submit(e) {
    e.preventDefault();
    setError("");

    if (!form.customer_id && !form.lead_id) {
      setError("Select a customer or a lead.");
      return;
    }

    try {
      const payload = {
        ...form,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        lead_id: form.lead_id ? Number(form.lead_id) : null,
      };

      if (editingId) {
        await api.put(`/followups/${editingId}`, payload);
      } else {
        await api.post("/followups", payload);
      }

      setForm(initialForm);
      setEditingId(null);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save follow-up.");
    }
  }

  function edit(item) {
    setEditingId(item.id);
    setForm({
      customer_id: item.customer_id || "",
      lead_id: item.lead_id || "",
      followup_date: item.followup_date
        ? String(item.followup_date).slice(0, 16)
        : "",
      followup_type: item.followup_type,
      subject: item.subject,
      remarks: item.remarks || "",
      status: item.status,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(id) {
    if (!window.confirm("Delete this follow-up?")) return;
    try {
      await api.delete(`/followups/${id}`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to delete follow-up.");
    }
  }

  const user = JSON.parse(localStorage.getItem("user") || "null");
  const canDelete = ["Admin", "Manager"].includes(user?.role);

  return (
    <div>
      <h2 className="mb-3">Follow-up Management</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      <form className="card card-body mb-4" onSubmit={submit}>
        <h5>{editingId ? "Edit Follow-up" : "Schedule Follow-up"}</h5>

        <div className="row g-3">
          <div className="col-md-4">
            <label className="form-label">Customer</label>
            <select
              className="form-select"
              value={form.customer_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  customer_id: e.target.value,
                  lead_id: "",
                })
              }
            >
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-4">
            <label className="form-label">Lead</label>
            <select
              className="form-select"
              value={form.lead_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  lead_id: e.target.value,
                  customer_id: "",
                })
              }
            >
              <option value="">Select lead</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-4">
            <label className="form-label">Date and Time</label>
            <input
              className="form-control"
              type="datetime-local"
              name="followup_date"
              value={form.followup_date}
              onChange={change}
              required
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Type</label>
            <select
              className="form-select"
              name="followup_type"
              value={form.followup_type}
              onChange={change}
            >
              {["Call", "Meeting", "Email", "Task"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>

          <div className="col-md-4">
            <label className="form-label">Subject</label>
            <input
              className="form-control"
              name="subject"
              value={form.subject}
              onChange={change}
              required
              minLength={2}
              maxLength={150}
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Status</label>
            <select
              className="form-select"
              name="status"
              value={form.status}
              onChange={change}
            >
              {["Planned", "Completed", "Missed", "Cancelled"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>

          <div className="col-12">
            <label className="form-label">Remarks</label>
            <textarea
              className="form-control"
              name="remarks"
              value={form.remarks}
              onChange={change}
              rows="2"
            />
          </div>
        </div>

        <div className="mt-3 d-flex gap-2">
          <button className="btn btn-primary">
            {editingId ? "Update Follow-up" : "Schedule Follow-up"}
          </button>
          {editingId && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setEditingId(null);
                setForm(initialForm);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="table-responsive">
        <table className="table table-striped table-hover align-middle">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Customer / Lead</th>
              <th>Date</th>
              <th>Type</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.subject}</td>
                <td>{item.customer_name || item.lead_name || "—"}</td>
                <td>{new Date(item.followup_date).toLocaleString()}</td>
                <td>{item.followup_type}</td>
                <td>
                  <span
                    className={`badge ${
                      item.status === "Completed"
                        ? "bg-success"
                        : item.status === "Missed"
                          ? "bg-danger"
                          : "bg-secondary"
                    }`}
                  >
                    {item.status}
                  </span>
                </td>
                <td className="text-nowrap">
                  <button
                    className="btn btn-sm btn-outline-primary me-2"
                    onClick={() => edit(item)}
                  >
                    Edit
                  </button>
                  {canDelete && (
                    <button
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => remove(item.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan="6" className="text-center">
                  No follow-ups found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
