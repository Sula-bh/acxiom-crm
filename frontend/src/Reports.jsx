import { useEffect, useState } from "react";
import api from "./api";

const dateFilters = [
  { key: "from_date", label: "From date", type: "date" },
  { key: "to_date", label: "To date", type: "date" },
];

const ownerFilter = { key: "owner_id", label: "Owner ID", type: "number" };

const reports = [
  {
    id: "customers",
    label: "Customers",
    endpoint: "/reports/customers",
    filters: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["Active", "Inactive"],
      },
      ownerFilter,
      ...dateFilters,
      { key: "search", label: "Search", type: "search" },
    ],
    sorts: ["name", "status", "created_at"],
    columns: [
      ["customer_code", "Code"],
      ["name", "Name"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["company_name", "Company"],
      ["status", "Status"],
      ["owner_name", "Owner"],
      ["created_at", "Created"],
    ],
  },
  {
    id: "leads",
    label: "Leads",
    endpoint: "/reports/leads",
    filters: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["New", "Contacted", "Qualified", "Unqualified", "Converted", "Lost"],
      },
      { key: "source", label: "Source", type: "search" },
      ownerFilter,
      ...dateFilters,
    ],
    sorts: ["created_at", "name", "status", "source"],
    columns: [
      ["lead_code", "Code"],
      ["name", "Name"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["source", "Source"],
      ["status", "Status"],
      ["priority", "Priority"],
      ["expected_value", "Expected value"],
      ["owner_name", "Owner"],
      ["created_at", "Created"],
    ],
  },
  {
    id: "followups",
    label: "Follow-ups",
    endpoint: "/reports/followups",
    filters: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: ["Planned", "Completed", "Missed", "Cancelled"],
      },
      { key: "overdue", label: "Overdue only", type: "checkbox" },
      ownerFilter,
      ...dateFilters,
    ],
    sorts: ["followup_date", "status"],
    columns: [
      ["subject", "Subject"],
      ["customer_name", "Customer"],
      ["lead_name", "Lead"],
      ["followup_date", "Date"],
      ["followup_type", "Type"],
      ["status", "Status"],
      ["owner_name", "Owner"],
    ],
  },
  {
    id: "opportunity-details",
    label: "Opportunities",
    endpoint: "/reports/opportunity-details",
    filters: [
      {
        key: "stage",
        label: "Stage",
        type: "select",
        options: ["Qualification", "Proposal", "Negotiation", "Won", "Lost"],
      },
      ownerFilter,
      ...dateFilters,
    ],
    sorts: ["name", "stage", "amount", "expected_close_date"],
    columns: [
      ["name", "Name"],
      ["customer_name", "Customer"],
      ["lead_name", "Lead"],
      ["amount", "Amount"],
      ["stage", "Stage"],
      ["probability", "Probability"],
      ["expected_close_date", "Expected close"],
      ["owner_name", "Owner"],
    ],
  },
  {
    id: "opportunities",
    label: "Pipeline",
    endpoint: "/reports/opportunities",
    filters: [
      {
        key: "stage",
        label: "Stage",
        type: "select",
        options: ["Qualification", "Proposal", "Negotiation", "Won", "Lost"],
      },
      ownerFilter,
      ...dateFilters,
    ],
    columns: [
      ["stage", "Stage"],
      ["owner_name", "Owner"],
      ["opportunity_count", "Opportunities"],
      ["total_amount", "Total amount"],
      ["pipeline_value", "Open pipeline"],
      ["weighted_pipeline_value", "Weighted pipeline"],
    ],
  },
  {
    id: "conversions",
    label: "Lead conversions",
    endpoint: "/reports/conversions",
    filters: [{ key: "source", label: "Source", type: "search" }, ownerFilter, ...dateFilters],
    columns: [
      ["source", "Source"],
      ["owner_name", "Owner"],
      ["lead_count", "Leads"],
      ["converted_count", "Converted"],
      ["conversion_rate", "Conversion rate (%)"],
    ],
  },
  {
    id: "user-activity",
    label: "User activity",
    endpoint: "/reports/user-activity",
    adminOnly: true,
    filters: [
      { key: "user_id", label: "User ID", type: "number" },
      ...dateFilters,
    ],
    columns: [
      ["user_id", "User ID"],
      ["user_name", "User"],
      ["action_count", "Actions"],
      ["last_activity", "Last activity"],
    ],
  },
  {
    id: "audit-logs",
    label: "Audit log",
    endpoint: "/reports/audit-logs",
    adminOnly: true,
    filters: [
      { key: "user_id", label: "User ID", type: "number" },
      { key: "action", label: "Action", type: "search" },
      { key: "entity_name", label: "Entity", type: "search" },
      ...dateFilters,
    ],
    sorts: ["created_at", "action", "entity_name"],
    columns: [
      ["created_at", "Timestamp"],
      ["user_name", "User"],
      ["action", "Action"],
      ["entity_name", "Entity"],
      ["record_id", "Record ID"],
      ["old_value", "Old value"],
      ["new_value", "New value"],
      ["ip_address", "IP address"],
    ],
  },
];

function csvValue(value) {
  if (value == null) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function Reports({ user }) {
  const availableReports = reports.filter(
    (report) => !report.adminOnly || user?.role === "Admin",
  );
  const [selectedId, setSelectedId] = useState("customers");
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const report =
    availableReports.find((item) => item.id === selectedId) ||
    availableReports[0];

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");

      try {
        const params = Object.fromEntries(
          Object.entries(filters).filter(
            ([, value]) => value !== "" && value != null,
          ),
        );
        const { data } = await api.get(report.endpoint, {
          params: { ...params, page, limit: 20 },
        });
        if (!cancelled) {
          setRows(Array.isArray(data) ? data : data.data || []);
          setTotal(Array.isArray(data) ? data.length : data.total || 0);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || "Unable to load this report.");
          setRows([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters, page, reload, report.endpoint]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function selectReport(id) {
    setSelectedId(id);
    setFilters({});
    setPage(1);
  }

  function exportCsv() {
    const content = [
      report.columns.map(([, label]) => csvValue(label)).join(","),
      ...rows.map((row) =>
        report.columns.map(([key]) => csvValue(row[key])).join(","),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `acxiomcrm-${report.id}-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const pageCount = Math.max(1, Math.ceil(total / 20));

  return (
    <section id="reports" className="mb-5" aria-labelledby="reports-heading">
      <h2 id="reports-heading" className="mb-3">
        Reports
      </h2>
      <div className="card card-body">
        <div className="row g-3 align-items-end mb-3">
          <div className="col-12 col-md-4">
            <label className="form-label" htmlFor="report-type">
              Report
            </label>
            <select
              id="report-type"
              className="form-select"
              value={report.id}
              onChange={(event) => selectReport(event.target.value)}
            >
              {availableReports.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          {report.filters.map((filter) => (
            <div className="col-12 col-sm-6 col-lg-3" key={filter.key}>
              {filter.type === "checkbox" ? (
                <div className="form-check">
                  <input
                    id={`report-${filter.key}`}
                    className="form-check-input"
                    type="checkbox"
                    checked={filters[filter.key] === "true"}
                    onChange={(event) =>
                      updateFilter(
                        filter.key,
                        event.target.checked ? "true" : "",
                      )
                    }
                  />
                  <label
                    className="form-check-label"
                    htmlFor={`report-${filter.key}`}
                  >
                    {filter.label}
                  </label>
                </div>
              ) : (
                <>
                  <label
                    className="form-label"
                    htmlFor={`report-${filter.key}`}
                  >
                    {filter.label}
                  </label>
                  {filter.type === "select" ? (
                    <select
                      id={`report-${filter.key}`}
                      className="form-select"
                      value={filters[filter.key] || ""}
                      onChange={(event) =>
                        updateFilter(filter.key, event.target.value)
                      }
                    >
                      <option value="">All</option>
                      {filter.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`report-${filter.key}`}
                      className="form-control"
                      type={filter.type}
                      min={filter.type === "number" ? 1 : undefined}
                      value={filters[filter.key] || ""}
                      onChange={(event) =>
                        updateFilter(filter.key, event.target.value)
                      }
                    />
                  )}
                </>
              )}
            </div>
          ))}
          {report.sorts && (
            <div className="col-12 col-sm-6 col-lg-3">
              <label className="form-label" htmlFor="report-sort">
                Sort by
              </label>
              <select
                id="report-sort"
                className="form-select"
                value={filters.sort || report.sorts[0]}
                onChange={(event) => updateFilter("sort", event.target.value)}
              >
                {report.sorts.map((sort) => (
                  <option key={sort} value={sort}>
                    {sort.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          )}
          {report.sorts && (
            <div className="col-12 col-sm-6 col-lg-2">
              <label className="form-label" htmlFor="report-direction">
                Direction
              </label>
              <select
                id="report-direction"
                className="form-select"
                value={filters.direction || "desc"}
                onChange={(event) =>
                  updateFilter("direction", event.target.value)
                }
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>
          )}
          <div className="col-12 col-sm-auto ms-sm-auto">
            <button
              className="btn btn-outline-primary w-100"
              onClick={exportCsv}
              disabled={loading || rows.length === 0}
            >
              Export page CSV
            </button>
          </div>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            <span>{error}</span>{" "}
            <button
              className="btn btn-sm btn-outline-danger"
              onClick={() => setReload((current) => current + 1)}
            >
              Retry
            </button>
          </div>
        )}

        <div className="table-responsive">
          <table className="table table-striped table-hover align-middle">
            <thead>
              <tr>
                {report.columns.map(([key, label]) => (
                  <th scope="col" key={key}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={report.columns.length} role="status">
                    Loading report...
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row, index) => (
                  <tr key={row.id || `${page}-${index}`}>
                    {report.columns.map(([key]) => (
                      <td key={key}>
                        {row[key] == null
                          ? "—"
                          : typeof row[key] === "object"
                            ? JSON.stringify(row[key])
                            : String(row[key])}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={report.columns.length} className="text-center">
                    No records match this report.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="d-flex justify-content-between align-items-center">
          <span>
            {total} record{total === 1 ? "" : "s"} · Page {page} of {pageCount}
          </span>
          <div className="btn-group">
            <button
              className="btn btn-outline-secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </button>
            <button
              className="btn btn-outline-secondary"
              disabled={page >= pageCount || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
