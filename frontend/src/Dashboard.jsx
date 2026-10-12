import { useEffect, useState } from "react";
import api from "./api";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Doughnut } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
);

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;

    api
      .get("/dashboard")
      .then(({ data }) => {
        if (!active) return;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          setError("Dashboard data is unavailable.");
          return;
        }
        setStats(data);
      })
      .catch(() => {
        if (active) setError("Unable to load dashboard.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [retryCount]);

  function retry() {
    setError("");
    setLoading(true);
    setRetryCount((count) => count + 1);
  }

  if (!stats) {
    return (
      <div>
        <h2 className="mb-4">Dashboard</h2>
        {error ? (
          <div className="alert alert-danger" role="alert">
            <p className="mb-2">{error}</p>
            <button className="btn btn-outline-danger" onClick={retry}>
              Retry
            </button>
          </div>
        ) : (
          <p role="status" aria-live="polite">
            {loading ? "Loading dashboard..." : "No dashboard data available."}
          </p>
        )}
      </div>
    );
  }

  const cards = [
    ["Total Customers", stats.total_customers ?? 0],
    ["Total Leads", stats.total_leads ?? 0],
    ["Open Leads", stats.open_leads ?? 0],
    ["Total Opportunities", stats.total_opportunities ?? 0],
    ["Open Opportunities", stats.open_opportunities ?? 0],
    ["Won Opportunities", stats.won_opportunities ?? 0],
    ["Lost Opportunities", stats.lost_opportunities ?? 0],
    [
      "Pipeline Value",
      Number(stats.pipeline_value || 0).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      }),
    ],
  ];

  const opportunityChart = {
    labels: ["Qualification", "Proposal", "Negotiation", "Won", "Lost"],
    datasets: [
      {
        label: "Opportunities",
        data: ["Qualification", "Proposal", "Negotiation", "Won", "Lost"].map(
          (stage) => Number(stats.opportunities_by_stage?.[stage] || 0),
        ),
        backgroundColor: [
          "#6366f1",
          "#3b82f6",
          "#f59e0b",
          "#22c55e",
          "#ef4444",
        ],
        borderRadius: 6,
      },
    ],
  };
  const opportunityCounts = opportunityChart.datasets[0].data;

  const leadChart = {
    labels: [
      "New",
      "Contacted",
      "Qualified",
      "Unqualified",
      "Converted",
      "Lost",
    ],
    datasets: [
      {
        data: [
          "New",
          "Contacted",
          "Qualified",
          "Unqualified",
          "Converted",
          "Lost",
        ].map((status) => Number(stats.leads_by_status?.[status] || 0)),
        backgroundColor: [
          "#3b82f6",
          "#8b5cf6",
          "#22c55e",
          "#ef4444",
          "#14b8a6",
          "#64748b",
        ],
        borderWidth: 1,
      },
    ],
  };
  const leadCounts = leadChart.datasets[0].data;

  return (
    <div>
      <h2 className="mb-4">Dashboard</h2>
      {error && (
        <div className="alert alert-warning d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button className="btn btn-outline-warning" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      {loading && (
        <p role="status" aria-live="polite">
          Refreshing dashboard...
        </p>
      )}
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
      <div className="row g-4 mt-2">
        <div className="col-lg-7">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h5>Opportunities by Stage</h5>
              <div style={{ position: "relative", height: "280px" }}>
                {opportunityCounts.some((count) => count > 0) ? (
                  <Bar
                    data={opportunityChart}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        y: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                      plugins: { legend: { display: false } },
                    }}
                  />
                ) : (
                  <p role="status">No opportunity data available.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h5>Leads by Status</h5>
              <div style={{ position: "relative", height: "280px" }}>
                {leadCounts.some((count) => count > 0) ? (
                  <Doughnut
                    data={leadChart}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { position: "bottom" } },
                    }}
                  />
                ) : (
                  <p role="status">No lead data available.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
