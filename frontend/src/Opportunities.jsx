import { useCallback, useEffect, useState } from "react";
import api from "./api";

const initialForm = {
  name: "",
  customer_id: "",
  lead_id: "",
  amount: "",
  stage: "Qualification",
  probability: 10,
  expected_close_date: "",
};

export default function Opportunities() {
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [opps, customerData, leadData] = await Promise.all([
        api.get("/opportunities", { params: { search } }),
        api.get("/customers"),
        api.get("/leads"),
      ]);
      setItems(opps.data);
      setCustomers(customerData.data);
      setLeads(leadData.data);
    } catch {
      setError("Unable to load opportunities or linked records.");
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 250);
    return () => clearTimeout(timer);
  }, [loadData]);

  function changeField(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!form.customer_id && !form.lead_id) {
      setError("Select a customer or a lead.");
      setLoading(false);
      return;
    }

    try {
      const payload = {
        ...form,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        lead_id: form.lead_id ? Number(form.lead_id) : null,
        amount: Number(form.amount),
        probability: Number(form.probability),
      };

      if (editingId) {
        await api.put(`/opportunities/${editingId}`, payload);
      } else {
        await api.post("/opportunities", payload);
      }

      setForm(initialForm);
      setEditingId(null);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to save opportunity.");
    } finally {
      setLoading(false);
    }
  }

  function edit(item) {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      customer_id: item.customer_id || "",
      lead_id: item.lead_id || "",
      amount: item.amount ?? "",
      stage: item.stage || "Qualification",
      probability: item.probability ?? 10,
      expected_close_date: item.expected_close_date
        ? String(item.expected_close_date).slice(0, 10)
        : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(id) {
    if (!window.confirm("Delete this opportunity?")) return;
    try {
      await api.delete(`/opportunities/${id}`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to delete opportunity.");
    }
  }

  const user = JSON.parse(localStorage.getItem("user") || "null");
  const canDelete = ["Admin", "Manager"].includes(user?.role);

  return (
    <div id="opportunities">
      <h2 className="mb-3">Opportunity Management</h2>

      {error && <div className="alert alert-danger">{error}</div>}

      <form className="card card-body mb-4" onSubmit={submit}>
        <h5>{editingId ? "Edit Opportunity" : "Add Opportunity"}</h5>

        <div className="row g-3">
          <div className="col-md-4">
            <label className="form-label">Opportunity Name</label>
            <input
              className="form-control"
              name="name"
              value={form.name}
              onChange={changeField}
              required
              minLength={2}
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Customer (optional)</label>
            <select
              className="form-select"
              name="customer_id"
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
            <label className="form-label">Lead (optional)</label>
            <select
              className="form-select"
              name="lead_id"
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
            <label className="form-label">Amount</label>
            <input
              className="form-control"
              type="number"
              min="0.01"
              step="0.01"
              name="amount"
              value={form.amount}
              onChange={changeField}
              required
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Stage</label>
            <select
              className="form-select"
              name="stage"
              value={form.stage}
              onChange={changeField}
            >
              {["Qualification", "Proposal", "Negotiation", "Won", "Lost"].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
          </div>

          <div className="col-md-4">
            <label className="form-label">Probability (%)</label>
            <input
              className="form-control"
              type="number"
              min="0"
              max="100"
              name="probability"
              value={form.probability}
              onChange={changeField}
              required
            />
          </div>

          <div className="col-md-4">
            <label className="form-label">Expected Close Date</label>
            <input
              className="form-control"
              type="date"
              name="expected_close_date"
              value={form.expected_close_date}
              onChange={changeField}
            />
          </div>
        </div>

        <div className="mt-3 d-flex gap-2">
          <button className="btn btn-primary" disabled={loading}>
            {loading ? "Saving..." : editingId ? "Update" : "Add Opportunity"}
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

      <input
        className="form-control mb-3"
        placeholder="Search opportunities by name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="table-responsive">
        <table className="table table-striped table-hover align-middle">
          <thead>
            <tr>
              <th>Name</th>
              <th>Customer / Lead</th>
              <th>Amount</th>
              <th>Stage</th>
              <th>Probability</th>
              <th>Close Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.customer_name || item.lead_name || "—"}</td>
                <td>{Number(item.amount).toLocaleString()}</td>
                <td>{item.stage}</td>
                <td>{item.probability}%</td>
                <td>
                  {item.expected_close_date
                    ? String(item.expected_close_date).slice(0, 10)
                    : "—"}
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
                <td colSpan="7" className="text-center">
                  No opportunities found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
