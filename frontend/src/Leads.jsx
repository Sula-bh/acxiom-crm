import { useEffect, useState } from "react";
import api from "./api";

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  company_name: "",
  source: "Website",
  status: "New",
  priority: "Medium",
  expected_value: 0,
};

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadLeads() {
    try {
      const { data } = await api.get("/leads", {
        params: { search },
      });
      setLeads(data);
    } catch {
      setError("Unable to load leads.");
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadLeads, 250);
    return () => clearTimeout(timer);
  }, [search]);

  function changeField(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const payload = {
        ...form,
        expected_value: Number(form.expected_value),
      };

      if (editingId) {
        await api.put(`/leads/${editingId}`, payload);
      } else {
        await api.post("/leads", payload);
      }

      setForm(emptyForm);
      setEditingId(null);
      await loadLeads();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save lead.");
    } finally {
      setLoading(false);
    }
  }

  function editLead(lead) {
    setEditingId(lead.id);
    setForm({
      name: lead.name || "",
      email: lead.email || "",
      phone: lead.phone || "",
      company_name: lead.company_name || "",
      source: lead.source || "Website",
      status: lead.status || "New",
      priority: lead.priority || "Medium",
      expected_value: lead.expected_value ?? 0,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteLead(id) {
    if (!window.confirm("Delete this lead?")) return;

    try {
      await api.delete(`/leads/${id}`);
      await loadLeads();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to delete lead.");
    }
  }

  return (
    <div>
      <h2 className="mb-3">Lead Management</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="card card-body mb-4">
        <h5>{editingId ? "Edit Lead" : "Add Lead"}</h5>

        <div className="row g-3">
          {[
            ["name", "Full Name", true],
            ["email", "Email", false],
            ["phone", "Phone", false],
            ["company_name", "Company", false],
            ["source", "Source", false],
            ["expected_value", "Expected Value", false],
          ].map(([name, label, required]) => (
            <div className="col-md-4" key={name}>
              <label className="form-label">{label}</label>
              <input
                className="form-control"
                name={name}
                value={form[name]}
                onChange={changeField}
                required={required}
                type={name === "expected_value" ? "number" : "text"}
                min={name === "expected_value" ? 0 : undefined}
              />
            </div>
          ))}

          <div className="col-md-4">
            <label className="form-label">Status</label>
            <select
              className="form-select"
              name="status"
              value={form.status}
              onChange={changeField}
            >
              {[
                "New",
                "Contacted",
                "Qualified",
                "Unqualified",
                "Converted",
                "Lost",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>

          <div className="col-md-4">
            <label className="form-label">Priority</label>
            <select
              className="form-select"
              name="priority"
              value={form.priority}
              onChange={changeField}
            >
              {["Low", "Medium", "High"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 d-flex gap-2">
          <button className="btn btn-primary" disabled={loading}>
            {loading ? "Saving..." : editingId ? "Update Lead" : "Add Lead"}
          </button>
          {editingId && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <input
        className="form-control mb-3"
        placeholder="Search by name, email, or company..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="table-responsive">
        <table className="table table-striped table-hover align-middle">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Company</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Value</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.lead_code}</td>
                <td>{lead.name}</td>
                <td>{lead.company_name || "—"}</td>
                <td>{lead.status}</td>
                <td>{lead.priority}</td>
                <td>{Number(lead.expected_value).toLocaleString()}</td>
                <td className="text-nowrap">
                  <button
                    className="btn btn-sm btn-outline-primary me-2"
                    onClick={() => editLead(lead)}
                  >
                    Edit
                  </button>
                  {["Admin", "Manager"].includes(
                    JSON.parse(localStorage.getItem("user") || "null")?.role,
                  ) && (
                    <button
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => deleteLead(lead.id)}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan="7" className="text-center">
                  No leads found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
