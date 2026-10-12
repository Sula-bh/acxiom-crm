import { useCallback, useEffect, useState } from "react";
import api from "./api";

const initialForm = {
  name: "",
  email: "",
  password: "",
  role: "SalesExecutive",
};

export default function Users() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(data);
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load users.");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadUsers();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  async function createUser(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      await api.post("/users", form);
      setForm(initialForm);
      setMessage("User created successfully.");
      await loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to create user.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus(user) {
    setError("");
    setMessage("");

    try {
      await api.patch(`/users/${user.id}/status`, {
        is_active: !user.is_active,
      });
      setMessage(`Account ${user.is_active ? "deactivated" : "activated"}.`);
      await loadUsers();
    } catch (err) {
      setError(err.response?.data?.error || "Unable to update account.");
    }
  }

  return (
    <div id="users">
      <h2 className="mb-3">User Management</h2>

      {error && <div className="alert alert-danger">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}

      <form className="card card-body mb-4" onSubmit={createUser}>
        <h5>Create User</h5>

        <div className="row g-3">
          <div className="col-md-3">
            <label className="form-label">Full Name</label>
            <input
              className="form-control"
              required
              minLength={2}
              maxLength={100}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div className="col-md-3">
            <label className="form-label">Email</label>
            <input
              className="form-control"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div className="col-md-3">
            <label className="form-label">Password</label>
            <input
              className="form-control"
              type="password"
              required
              minLength={12}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <small className="text-muted">
              Use 12+ characters, including uppercase, lowercase, a number, and
              a special character.
            </small>
          </div>

          <div className="col-md-3">
            <label className="form-label">Role</label>
            <select
              className="form-select"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="SalesExecutive">Sales Executive</option>
              <option value="Manager">Manager</option>
              <option value="Admin">Admin</option>
            </select>
          </div>
        </div>

        <div className="mt-3">
          <button className="btn btn-primary" disabled={loading}>
            {loading ? "Creating..." : "Create User"}
          </button>
        </div>
      </form>

      <div className="table-responsive">
        <table className="table table-striped table-hover align-middle">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>
                  <span
                    className={`badge ${
                      user.is_active ? "bg-success" : "bg-secondary"
                    }`}
                  >
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  <button
                    className={`btn btn-sm ${
                      user.is_active
                        ? "btn-outline-danger"
                        : "btn-outline-success"
                    }`}
                    onClick={() => toggleStatus(user)}
                  >
                    {user.is_active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan="6" className="text-center">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
