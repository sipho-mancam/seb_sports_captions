import { Navigate, useNavigate } from "react-router-dom";
import { useAppFlow } from "../context/AppFlowContext";

const sources = ["API", "Database (MySQL)", "Excel Spreadsheet"];

export default function DataSourcePage() {
  const navigate = useNavigate();
  const { state, setSource } = useAppFlow();

  if (!state.selectedSport) {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="panel">
      <h2>2. Select Data Source</h2>
      <p className="subtitle">Sport: {state.selectedSport}</p>
      <div className="source-list">
        {sources.map((source) => (
          <button
            type="button"
            key={source}
            className={`source-button ${state.selectedSource === source ? "selected" : ""}`}
            onClick={() => {
              setSource(source);
              navigate("/tournaments");
            }}
          >
            {source}
          </button>
        ))}
      </div>
    </section>
  );
}
