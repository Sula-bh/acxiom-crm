import { useEffect, useState } from "react";
import api from "./api";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/dashboard")
      .then(({ data }) => setStats(data))
      .catch(() => setError("Unable to load dashboard."));
  }, []);

  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!stats) return <p>Loading dashboard...</p>;

  const cards = [
    ["Total Customers", stats.total_customers],
    ["Total Leads", stats.total_leads],
    ["Open Leads", stats.open_leads],
    ["Total Opportunities", stats.total_opportunities],
    ["Open Opportunities", stats.open_opportunities],
    ["Won Opportunities", stats.won_opportunities],
    ["Lost Opportunities", stats.lost_opportunities],
    ["Pipeline Value", Number(stats.pipeline_value).toLocaleString()],
  ];

  return (
    <div>
      <h2 className="mb-4">Dashboard</h2>
      <div className="row g-3">
        {cards.map(([label, value]) => (
          <div className="col-12 col-sm-6 col-xl-3" key={label}>
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <p className="text-secondary mb-2">{label}</p>
                <h3 className="fw-bold mb-0">{value}</h3>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
