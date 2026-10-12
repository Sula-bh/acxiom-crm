import { useEffect, useState } from "react";
import api from "./api";

const emptyForm = {
  customerCode: "",
  name: "",
  email: "",
  phone: "",
  companyName: "",
  address: "",
  city: "",
  state: "",
  status: "Active",
};

export default function App() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadCustomers() {
    try {
      setLoading(true);
      const response = await api.get("/customers", {
        params: { search },
      });
      setCustomers(response.data);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.error || "Unable to load customers. Please log in.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadCustomers, 250);
    return () => clearTimeout(timer);
  }, [search]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function openEdit(customer) {
    setEditingId(customer.id);
    setForm({
      customerCode: customer.customer_code,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      companyName: customer.company_name || "",
      address: customer.address || "",
      city: customer.city || "",
      state: customer.state || "",
      status: customer.status,
    });
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  async function saveCustomer(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    try {
      if (editingId) {
        await api.put(`/customers/${editingId}`, form);
        setSuccess("Customer updated successfully.");
      } else {
        await api.post("/customers", form);
        setSuccess("Customer created successfully.");
      }

      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      await loadCustomers();
    } catch (err) {
      const details = err.response?.data?.details
        ?.map((item) => item.message)
        .join(", ");

      setError(
        details || err.response?.data?.error || "Unable to save customer.",
      );
    }
  }

  async function deleteCustomer(customer) {
    if (!window.confirm(`Delete ${customer.name}?`)) return;

    try {
      await api.delete(`/customers/${customer.id}`);
      setSuccess("Customer deleted successfully.");
      await loadCustomers();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to delete customer.");
    }
  }

  function updateField(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  return (
    <div className="container-fluid bg-light min-vh-100">
      <header className="bg-dark text-white px-4 py-3 d-flex justify-content-between align-items-center">
        <h4 className="mb-0">AcxiomCRM</h4>
        <span>Customer Management</span>
      </header>

      <main className="container py-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2>Customers</h2>
            <p className="text-secondary mb-0">
              Manage your customer relationships
            </p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>
            + Add Customer
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {showForm && (
          <div className="card shadow-sm mb-4">
            <div className="card-header fw-bold">
              {editingId ? "Edit Customer" : "New Customer"}
            </div>
            <div className="card-body">
              <form onSubmit={saveCustomer}>
                <div className="row g-3">
                  {[
                    ["customerCode", "Customer Code", true],
                    ["name", "Customer Name", true],
                    ["email", "Email", true],
                    ["phone", "Phone", true],
                    ["companyName", "Company", false],
                    ["address", "Address", false],
                    ["city", "City", false],
                    ["state", "State", false],
                  ].map(([name, label, required]) => (
                    <div className="col-md-6" key={name}>
                      <label className="form-label">{label}</label>
                      <input
                        className="form-control"
                        name={name}
                        value={form[name]}
                        onChange={updateField}
                        required={required}
                        maxLength={name === "address" ? 1000 : 255}
                        type={name === "email" ? "email" : "text"}
                      />
                    </div>
                  ))}

                  <div className="col-md-6">
                    <label className="form-label">Status</label>
                    <select
                      className="form-select"
                      name="status"
                      value={form.status}
                      onChange={updateField}
                    >
                      <option>Active</option>
                      <option>Inactive</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4 d-flex gap-2">
                  <button className="btn btn-primary" type="submit">
                    Save Customer
                  </button>
                  <button
                    className="btn btn-outline-secondary"
                    type="button"
                    onClick={() => setShowForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="card shadow-sm">
          <div className="card-body">
            <input
              className="form-control mb-3"
              placeholder="Search by name, email, phone or company..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {loading ? (
              <p>Loading customers...</p>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle">
                  <thead className="table-light">
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Company</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((customer) => (
                      <tr key={customer.id}>
                        <td>{customer.customer_code}</td>
                        <td>{customer.name}</td>
                        <td>{customer.company_name || "—"}</td>
                        <td>{customer.email}</td>
                        <td>{customer.phone}</td>
                        <td>
                          <span
                            className={`badge ${
                              customer.status === "Active"
                                ? "text-bg-success"
                                : "text-bg-secondary"
                            }`}
                          >
                            {customer.status}
                          </span>
                        </td>
                        <td>
                          <div className="d-flex gap-2">
                            <button
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => openEdit(customer)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => deleteCustomer(customer)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {customers.length === 0 && (
                      <tr>
                        <td colSpan="7" className="text-center py-4">
                          No customers found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
