import { useCallback, useEffect, useState } from "react";
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

function getLocalDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversionLead, setConversionLead] = useState(null);
  const [conversionForm, setConversionForm] = useState(null);
  const [conversionError, setConversionError] = useState("");
  const [converting, setConverting] = useState(false);

  const loadLeads = useCallback(async () => {
    try {
      const { data } = await api.get("/leads", {
        params: { search },
      });
      setLeads(data);
    } catch {
      setError("Unable to load leads.");
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(loadLeads, 250);
    return () => clearTimeout(timer);
  }, [loadLeads]);

  function changeField(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
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
      setSuccess("Lead deleted successfully.");
      await loadLeads();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to delete lead.");
    }
  }

  function openConversion(lead) {
    setConversionLead(lead);
    setConversionForm({
      email: lead.email || "",
      phone: lead.phone || "",
      createOpportunity: Number(lead.expected_value) > 0,
      expectedCloseDate: "",
    });
    setConversionError("");
  }

  async function convertLead(e) {
    e.preventDefault();
    setConversionError("");
    setConverting(true);

    try {
      const { data } = await api.post(
        `/leads/${conversionLead.id}/convert`,
        conversionForm,
      );
      setSuccess(
        data.alreadyConverted
          ? "This lead was already converted."
          : "Lead converted successfully.",
      );
      setConversionLead(null);
      setConversionForm(null);
      await loadLeads();
    } catch (err) {
      setConversionError(
        err.response?.data?.error || "Unable to convert lead.",
      );
    } finally {
      setConverting(false);
    }
  }

  return (
    <div id="leads">
      <h2 className="mb-3">Lead Management</h2>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

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
                  {lead.status !== "Converted" && (
                    <button
                      className="btn btn-sm btn-outline-primary me-2"
                      onClick={() => editLead(lead)}
                    >
                      Edit
                    </button>
                  )}
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
                  {lead.status === "Qualified" && (
                    <button
                      className="btn btn-sm btn-outline-success"
                      onClick={() => openConversion(lead)}
                    >
                      Convert
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

      {conversionLead && conversionForm && (
        <>
          <div
            className="modal show d-block"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lead-conversion-title"
            tabIndex="-1"
          >
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content text-start">
                <form onSubmit={convertLead}>
                  <div className="modal-header">
                    <h5 className="modal-title" id="lead-conversion-title">
                      Convert {conversionLead.name}
                    </h5>
                    <button
                      type="button"
                      className="btn-close"
                      aria-label="Close"
                      onClick={() => setConversionLead(null)}
                    />
                  </div>
                  <div className="modal-body">
                    {conversionError && (
                      <div className="alert alert-danger" role="alert">
                        {conversionError}
                      </div>
                    )}
                    <div className="mb-3">
                      <label className="form-label" htmlFor="conversion-email">
                        Customer email
                      </label>
                      <input
                        className="form-control"
                        id="conversion-email"
                        type="email"
                        maxLength={255}
                        required
                        value={conversionForm.email}
                        onChange={(e) =>
                          setConversionForm({
                            ...conversionForm,
                            email: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label" htmlFor="conversion-phone">
                        Customer phone
                      </label>
                      <input
                        className="form-control"
                        id="conversion-phone"
                        type="tel"
                        pattern="^\+?[0-9]{10,15}$"
                        maxLength={16}
                        required
                        value={conversionForm.phone}
                        onChange={(e) =>
                          setConversionForm({
                            ...conversionForm,
                            phone: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="form-check mb-3">
                      <input
                        className="form-check-input"
                        id="conversion-opportunity"
                        type="checkbox"
                        disabled={Number(conversionLead.expected_value) <= 0}
                        checked={conversionForm.createOpportunity}
                        onChange={(e) =>
                          setConversionForm({
                            ...conversionForm,
                            createOpportunity: e.target.checked,
                          })
                        }
                      />
                      <label
                        className="form-check-label"
                        htmlFor="conversion-opportunity"
                      >
                        Create an opportunity for{" "}
                        {Number(conversionLead.expected_value).toLocaleString()}
                      </label>
                    </div>
                    {Number(conversionLead.expected_value) <= 0 && (
                      <p className="form-text">
                        An opportunity requires a positive expected lead value.
                      </p>
                    )}
                    {conversionForm.createOpportunity && (
                      <div className="mb-3">
                        <label
                          className="form-label"
                          htmlFor="conversion-close-date"
                        >
                          Expected close date
                        </label>
                        <input
                          className="form-control"
                          id="conversion-close-date"
                          type="date"
                          min={getLocalDate()}
                          required
                          value={conversionForm.expectedCloseDate}
                          onChange={(e) =>
                            setConversionForm({
                              ...conversionForm,
                              expectedCloseDate: e.target.value,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                  <div className="modal-footer">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => setConversionLead(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-success"
                      disabled={converting}
                    >
                      {converting ? "Converting..." : "Convert Lead"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div className="modal-backdrop show" />
        </>
      )}
    </div>
  );
}
