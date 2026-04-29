import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import '../styles/MatchStatsPage.css';

const BASE_URL = 'http://localhost:8080';

function normalizeMatchStatsPayload(payload) {
  if (payload?.match) {
    return payload.match;
  }

  if (payload?.data) {
    return payload.data;
  }

  return payload;
}

function getTeam(teamData, fallbackName) {
  if (teamData?.team) {
    return teamData.team;
  }

  if (teamData) {
    return teamData;
  }

  return { id: null, name: fallbackName };
}

function getTeamStats(matchData, side) {
  const teamData = matchData?.[side];

  return teamData?.teamStats || teamData?.stats || matchData?.teamStats || {};
}

function getScoreForTeam(scores, teamId, fallbackKey) {
  if (!Array.isArray(scores)) {
    return null;
  }

  return (
    scores.find((score) => score.teamId === teamId) ||
    scores.find((score) => score.side === fallbackKey) ||
    scores[0] ||
    null
  );
}

function getTeamScore(matchData, side, teamId) {
  const nestedScore = matchData?.[side]?.score;

  if (nestedScore) {
    return nestedScore;
  }

  return getScoreForTeam(matchData?.score, teamId, side === 'homeTeam' ? 'home' : 'away');
}

function formatNumber(value) {
  return value !== null && value !== undefined ? value : '-';
}

function formatRate(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }

  return `${Number(value).toFixed(1)}%`;
}

function calculatePercentage(numerator, denominator) {
  if (!denominator) {
    return '-';
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}

const MatchStatsPage = () => {
  const navigate = useNavigate();
  const { matchId } = useParams();
  const [matchStats, setMatchStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMatchStats();
  }, [matchId]);

  const fetchMatchStats = async () => {
    try {
      setLoading(true);
      const apiUrl = new URL(`${BASE_URL}/api/v1/sportscaption/matches/rugbyviz/stats`);
      apiUrl.searchParams.set('matchId', matchId);

      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      setMatchStats(normalizeMatchStatsPayload(data));
      setError(null);
    } catch (err) {
      console.error('Error fetching match stats:', err);
      setError(err.message || 'Failed to load match statistics');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="match-stats-page loading">Loading match statistics...</div>;
  }

  if (error) {
    return (
      <div className="match-stats-page error">
        <p>Error: {error}</p>
        <button onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  if (!matchStats) {
    return <div className="match-stats-page">No match data available</div>;
  }

  const homeTeam = getTeam(matchStats.homeTeam, 'Home Team');
  const awayTeam = getTeam(matchStats.awayTeam, 'Away Team');
  const homeScore = getTeamScore(matchStats, 'homeTeam', homeTeam.id);
  const awayScore = getTeamScore(matchStats, 'awayTeam', awayTeam.id);
  const homeStats = getTeamStats(matchStats, 'homeTeam');
  const awayStats = getTeamStats(matchStats, 'awayTeam');
  const matchDate = matchStats.dateTime ? new Date(matchStats.dateTime).toLocaleDateString() : 'Date TBC';
  const matchVenue = matchStats.venue?.name || matchStats.venueName || 'Venue TBC';
  const matchStatus = matchStats.matchStatus ? matchStats.matchStatus.toUpperCase() : 'MATCH';

  return (
    <div className="match-stats-page">
      {/* Match Header */}
      <div className="match-header">
        <div className="match-info">
          <div className="match-date-venue">
            <span className="match-date">{matchDate}</span>
            <span className="match-venue">{matchVenue}</span>
            <span className="match-attendance">Attendance: {formatNumber(matchStats.attendance)}</span>
          </div>

          <div className="match-score">
            <div className="team home-team">
              <div className="team-name">{homeTeam.name}</div>
              <div className="team-score">{formatNumber(homeScore?.ftScore ?? homeScore?.finalScore ?? homeScore?.currentScore)}</div>
            </div>

            <div className="match-status">
              <div className="status">{matchStatus}</div>
              {matchStats.matchStatus === 'result' && (
                <div className="half-time">HT: {formatNumber(homeScore?.htScore)} - {formatNumber(awayScore?.htScore)}</div>
              )}
            </div>

            <div className="team away-team">
              <div className="team-name">{awayTeam.name}</div>
              <div className="team-score">{formatNumber(awayScore?.ftScore ?? awayScore?.finalScore ?? awayScore?.currentScore)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Sections */}
      <div className="stats-container">
        {/* SCORING Section */}
        <StatsSection title="SCORING">
          <StatRow label="Points" homeVal={homeStats?.scoring?.points} awayVal={awayStats?.scoring?.points} />
          <StatRow label="Tries" homeVal={homeStats?.scoring?.tryScored} awayVal={awayStats?.scoring?.tryScored} />
          <StatRow label="Conversions" homeVal={homeStats?.scoring?.conversion} awayVal={awayStats?.scoring?.conversion} />
          <StatRow label="Penalties" homeVal={homeStats?.scoring?.penaltyGoal} awayVal={awayStats?.scoring?.penaltyGoal} />
          <StatRow label="Drop Goals" homeVal={homeStats?.scoring?.dropGoal} awayVal={awayStats?.scoring?.dropGoal} />
          <StatRow 
            label="Kicking Success" 
            homeVal={calculatePercentage(homeStats?.scoring?.successfulGoals, homeStats?.scoring?.goalAttempts)}
            awayVal={calculatePercentage(awayStats?.scoring?.successfulGoals, awayStats?.scoring?.goalAttempts)}
            isPercentage
          />
        </StatsSection>

        {/* ATTACK Section */}
        <StatsSection title="ATTACK">
          <StatRow label="Metres Made" homeVal={homeStats?.attack?.metresMade} awayVal={awayStats?.attack?.metresMade} />
          <StatRow label="Carries" homeVal={homeStats?.attack?.carries} awayVal={awayStats?.attack?.carries} />
          <StatRow label="Clean Breaks" homeVal={homeStats?.attack?.cleanBreak} awayVal={awayStats?.attack?.cleanBreak} />
          <StatRow label="Defenders Beaten" homeVal={homeStats?.attack?.defenderBeaten} awayVal={awayStats?.attack?.defenderBeaten} />
          <StatRow label="Offloads" homeVal={homeStats?.attack?.offload} awayVal={awayStats?.attack?.offload} />
          <StatRow label="Passes" homeVal={homeStats?.attack?.passes} awayVal={awayStats?.attack?.passes} />
          <StatRow 
            label="Possession" 
            homeVal={formatRate(homeStats?.possession?.percentPossession)} 
            awayVal={formatRate(awayStats?.possession?.percentPossession)}
            isPercentage
          />
          <StatRow 
            label="Territory" 
            homeVal={formatRate(homeStats?.possession?.percentTerritory)} 
            awayVal={formatRate(awayStats?.possession?.percentTerritory)}
            isPercentage
          />
        </StatsSection>

        {/* DEFENCE Section */}
        <StatsSection title="DEFENCE">
          <StatRow label="Tackles Made" homeVal={homeStats?.defence?.tackle} awayVal={awayStats?.defence?.tackle} />
          <StatRow 
            label="Tackle Success" 
            homeVal={formatRate(homeStats?.defence?.percentTackleMade)}
            awayVal={formatRate(awayStats?.defence?.percentTackleMade)}
            isPercentage
          />
          <StatRow label="Turnovers Won" homeVal={homeStats?.defence?.turnoverWon} awayVal={awayStats?.defence?.turnoverWon} />
        </StatsSection>

        {/* SET PIECE Section */}
        <StatsSection title="SET PIECE">
          <StatRow label="Lineouts Won" homeVal={homeStats?.lineout?.wonClean} awayVal={awayStats?.lineout?.wonClean} />
          <StatRow 
            label="Lineout Success" 
            homeVal={formatRate(homeStats?.lineout?.percentLineoutsWon)}
            awayVal={formatRate(awayStats?.lineout?.percentLineoutsWon)}
            isPercentage
          />
          <StatRow label="Lineout Steals" homeVal={homeStats?.lineout?.lineoutSteals} awayVal={awayStats?.lineout?.lineoutSteals} />
          <StatRow label="Scrums Won" homeVal={homeStats?.scrum?.scrumsWon} awayVal={awayStats?.scrum?.scrumsWon} />
          <StatRow 
            label="Scrums Success" 
            homeVal={formatRate(homeStats?.scrum?.percentScrumsWon)}
            awayVal={formatRate(awayStats?.scrum?.percentScrumsWon)}
            isPercentage
          />
        </StatsSection>

        {/* KICKING Section */}
        <StatsSection title="KICKING">
          <StatRow label="Kicks in Play" homeVal={homeStats?.kicking?.kicksInPlay} awayVal={awayStats?.kicking?.kicksInPlay} />
          <StatRow label="Kick Metres" homeVal={homeStats?.kicking?.allKickMetres} awayVal={awayStats?.kicking?.allKickMetres} />
          <StatRow label="Retained Kicks" homeVal={homeStats?.kicking?.retainedKick} awayVal={awayStats?.kicking?.retainedKick} />
          <StatRow label="Penalty Goals" homeVal={homeStats?.kicking?.penaltyGoal} awayVal={awayStats?.kicking?.penaltyGoal} />
        </StatsSection>

        {/* BREAKDOWN Section */}
        <StatsSection title="BREAKDOWN">
          <StatRow label="Rucks Won" homeVal={homeStats?.possession?.ruckWonOutright} awayVal={awayStats?.possession?.ruckWonOutright} />
          <StatRow label="Rucks Lost" homeVal={homeStats?.possession?.ruckLostOutright} awayVal={awayStats?.possession?.ruckLostOutright} />
          <StatRow 
            label="Ruck Success" 
            homeVal={formatRate(homeStats?.possession?.percentRucksWon)}
            awayVal={formatRate(awayStats?.possession?.percentRucksWon)}
            isPercentage
          />
          <StatRow label="Turnovers in Rucks" homeVal={homeStats?.possession?.ruckTryScored} awayVal={awayStats?.possession?.ruckTryScored} />
          <StatRow label="Mauls Total" homeVal={(homeStats?.possession?.maulWonOutright || 0) + (homeStats?.possession?.maulLostOutright || 0)} 
                   awayVal={(awayStats?.possession?.maulWonOutright || 0) + (awayStats?.possession?.maulLostOutright || 0)} />
          <StatRow 
            label="Mauls Success" 
            homeVal={formatRate(homeStats?.possession?.percentMaulsWon)}
            awayVal={formatRate(awayStats?.possession?.percentMaulsWon)}
            isPercentage
          />
          <StatRow label="Maul Metres" homeVal={homeStats?.possession?.maulMetres || 0} awayVal={awayStats?.possession?.maulMetres || 0} />
        </StatsSection>

        {/* DISCIPLINE Section */}
        <StatsSection title="DISCIPLINE">
          <StatRow label="Penalties Conceded" homeVal={homeStats?.discipline?.penaltyConceded} awayVal={awayStats?.discipline?.penaltyConceded} />
          <StatRow label="Yellow Cards" homeVal={homeStats?.discipline?.yellowCard} awayVal={awayStats?.discipline?.yellowCard} />
          <StatRow label="Red Cards" homeVal={homeStats?.discipline?.redCard} awayVal={awayStats?.discipline?.redCard} />
        </StatsSection>
      </div>

      {/* Back Button */}
      <div className="action-buttons">
        <button className="btn-back" onClick={() => navigate(-1)}>← Back to Match</button>
      </div>
    </div>
  );
};

// Reusable Stats Section Component
const StatsSection = ({ title, children }) => (
  <div className="stats-section">
    <h2 className="section-title">{title}</h2>
    <div className="stats-grid">
      {children}
    </div>
  </div>
);

// Reusable Stat Row Component
const StatRow = ({ label, homeVal, awayVal, isPercentage = false }) => (
  <div className="stat-row">
    <div className="stat-home">{formatNumber(homeVal)}</div>
    <div className="stat-label">{label}</div>
    <div className="stat-away">{formatNumber(awayVal)}</div>
  </div>
);

export default MatchStatsPage;
