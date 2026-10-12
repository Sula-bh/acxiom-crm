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

  const stageCounts = [
    "Qualification",
    "Proposal",
    "Negotiation",
    "Won",
    "Lost",
  ].map((stage) => ({
    stage,
    count: stats.opportunities_by_stage?.[stage] || 0,
  }));

  const leadCounts = [
    "New",
    "Contacted",
    "Qualified",
    "Unqualified",
    "Converted",
    "Lost",
  ].map((status) => ({
    status,
    count: stats.leads_by_status?.[status] || 0,
  }));

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
      <div className="row g-4 mt-2">
        <div className="col-lg-7">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h5>Opportunities by Stage</h5>
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
            </div>
          </div>
        </div>

        <div className="col-lg-5">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h5>Leads by Status</h5>
              <Doughnut
                data={leadChart}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { position: "bottom" } },
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
