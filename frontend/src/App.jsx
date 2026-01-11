import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import zoomPlugin from 'chartjs-plugin-zoom'
import './App.css'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  zoomPlugin,
  Tooltip,
  Legend,
)

const parseVideoId = (value) => {
  if (!value) return ''
  const trimmed = value.trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace('/', '')
    }
    if (url.searchParams.has('v')) {
      return url.searchParams.get('v') || ''
    }
    const parts = url.pathname.split('/').filter(Boolean)
    const liveIndex = parts.indexOf('live')
    if (liveIndex !== -1 && parts[liveIndex + 1]) {
      return parts[liveIndex + 1]
    }
  } catch (err) {
    return ''
  }
  return ''
}

function App() {
  const [videoInput, setVideoInput] = useState('')
  const [videoId, setVideoId] = useState('')
  const [mode, setMode] = useState('general')
  const [keywords, setKeywords] = useState('')
  const [threshold, setThreshold] = useState('2')
  const [status, setStatus] = useState('Idle')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState('')
  const [events, setEvents] = useState([])
  const [history, setHistory] = useState([])
  const [videoTitle, setVideoTitle] = useState('Waiting...')
  const [videoChannel, setVideoChannel] = useState('Waiting...')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [rates, setRates] = useState([])
  const [rateLabels, setRateLabels] = useState([])

  const chartRef = useRef(null)
  const canvasRef = useRef(null)

  const showStreamerPanels = mode === 'streamer'

  const summaryItems = useMemo(() => {
    if (!summary) return []
    return summary 
      .split('\n')
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
  }, [summary])

  useEffect(() => {
    if (!canvasRef.current) return () => {}
    if (chartRef.current) {
      chartRef.current.destroy()
    }
    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Messages per second',
            data: [],
            borderColor: 'rgba(130, 241, 255, 1)',
            backgroundColor: 'rgba(130, 241, 255, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: 'rgba(244, 246, 255, 0.9)',
              font: {
                family: '"Space Grotesk", "Segoe UI", sans-serif',
              },
            },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(43, 15, 104, 0.95)',
            titleColor: 'rgba(244, 246, 255, 1)',
            bodyColor: 'rgba(244, 246, 255, 0.9)',
            borderColor: 'rgba(130, 241, 255, 0.5)',
            borderWidth: 1,
          },
          zoom: {
            pan: {
              enabled: true,
              mode: 'x',
            },
            zoom: {
              wheel: { enabled: false },
              pinch: { enabled: false },
              drag: { enabled: false },
              mode: 'x',
            },
            limits: {
              x: { minRange: 5 },
              y: { min: 0 },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: 'rgba(244, 246, 255, 0.7)',
              font: {
                family: '"Space Grotesk", "Segoe UI", sans-serif',
              },
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
          },
          y: {
            beginAtZero: true,
            grace: '15%',
            ticks: {
              color: 'rgba(244, 246, 255, 0.7)',
              font: {
                family: '"Space Grotesk", "Segoe UI", sans-serif',
              },
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
            title: {
              display: true,
              text: 'Messages/sec',
              color: 'rgba(244, 246, 255, 0.9)',
              font: {
                family: '"Space Grotesk", "Segoe UI", sans-serif',
              },
            },
          },
        },
        interaction: {
          mode: 'nearest',
          axis: 'x',
          intersect: false,
        },
      },
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    setRateLabels((prev) => {
      if (!Array.isArray(rates)) return []
      if (rates.length < prev.length) {
        const now = Date.now()
        return Array.from({ length: rates.length }, (_, i) =>
          new Date(now - (rates.length - 1 - i) * 1000).toLocaleTimeString(),
        )
      }
      if (rates.length === prev.length) return prev
      const additions = rates.length - prev.length
      const now = Date.now()
      const appended = Array.from({ length: additions }, (_, i) =>
        new Date(now - (additions - 1 - i) * 1000).toLocaleTimeString(),
      )
      return [...prev, ...appended]
    })
  }, [rates])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const maxPoints = 100
    const displayRates = Array.isArray(rates) ? rates.slice(-maxPoints) : []
    const displayLabels = Array.isArray(rateLabels) ? rateLabels.slice(-maxPoints) : []
    chart.data.labels = displayLabels
    chart.data.datasets[0].data = displayRates
    chart.update('none')
  }, [rates, rateLabels])

  useEffect(() => {
    if (!videoId) return () => {}
    let active = true
    let timerId

    const fetchSummary = async () => {
      setStatus('Updating')
      setError('')
      try {
        const keywordParam = mode === 'streamer' && keywords
          ? `&keywords=${encodeURIComponent(keywords)}`
          : ''
        const thresholdParam = mode === 'streamer'
          ? `&keywordThreshold=${encodeURIComponent(threshold)}`
          : ''
        const response = await fetch(
          `/api/summary?videoId=${encodeURIComponent(videoId)}&mode=${encodeURIComponent(mode)}${keywordParam}${thresholdParam}`,
        )
        const payload = await response.json()
        if (!response.ok || payload.error) {
          throw new Error(payload.error || 'Unable to fetch summary.')
        }
        if (!active) return
        setSummary(payload.summary || '')
        setEvents(payload.events || [])
        setHistory(payload.summaryHistory || [])
        setVideoTitle(payload.videoTitle || 'Unknown')
        setVideoChannel(payload.videoChannel || 'Unknown')
        setRates(Array.isArray(payload.rates) ? payload.rates : [])
        setStatus(payload.summary ? 'Live' : 'Waiting')
        setUpdatedAt(payload.updatedAt || null)
      } catch (err) {
        if (!active) return
        setStatus('Offline')
        setError(err.message || 'Unable to fetch summary.')
      }
      timerId = window.setTimeout(fetchSummary, 8000)
    }

    fetchSummary()

    return () => {
      active = false
      if (timerId) window.clearTimeout(timerId)
    }
  }, [videoId, mode, keywords, threshold])

  const handleSubmit = (event) => {
    event.preventDefault()
    const id = parseVideoId(videoInput)
    if (!id) {
      setError('Paste a valid YouTube livestream link or video ID.')
      return
    }
    setVideoId(id)
    setStatus('Connecting')
    setError('')
    setSummary('')
    setEvents([])
    setHistory([])
    setRates([])
    setRateLabels([])
    setUpdatedAt(null)
  }

  const handleReset = () => {
    setVideoInput('')
    setVideoId('')
    setMode('general')
    setKeywords('')
    setThreshold('2')
    setStatus('Idle')
    setError('')
    setSummary('')
    setEvents([])
    setHistory([])
    setRates([])
    setRateLabels([])
    setVideoTitle('Waiting...')
    setVideoChannel('Waiting...')
    setUpdatedAt(null)
    const chart = chartRef.current
    if (chart) {
      chart.data.labels = []
      chart.data.datasets[0].data = []
      chart.update('none')
    }
  }

  const handleZoomIn = () => {
    const chart = chartRef.current
    if (!chart || typeof chart.zoom !== 'function') return
    chart.zoom({ x: 1.2 })
  }

  const handleZoomOut = () => {
    const chart = chartRef.current
    if (!chart || typeof chart.zoom !== 'function') return
    chart.zoom({ x: 0.8 })
  }

  const handleResetZoom = () => {
    const chart = chartRef.current
    if (!chart || typeof chart.resetZoom !== 'function') return
    chart.resetZoom()
  }

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return ''
    const date = new Date(updatedAt * 1000)
    return `Updated ${date.toLocaleTimeString()}`
  }, [updatedAt])

  return (
    <main className="app">
      <section className="frame">
        <header>
          <h1>Spectator</h1>
          <p className="eyebrow">Livestream Summarizer</p>
          <p className="subtitle">
            Paste your YouTube livestream link, pick a mode, and watch the summary update in real time.
          </p>
        </header>

        <section className="panel-grid">
          <div className="card">
            <form id="summary-form" onSubmit={handleSubmit}>
              <label htmlFor="youtube-link">YouTube livestream link</label>
              <input
                id="youtube-link"
                type="text"
                placeholder="https://www.youtube.com/watch?v=xxxxxxxxxxx"
                required
                value={videoInput}
                onChange={(e) => setVideoInput(e.target.value)}
              />

              <div className="toggle-row">
                <span className="toggle-label">Summary mode</span>
                <div className="toggle-group" role="radiogroup">
                  <label className="toggle">
                    <input
                      type="radio"
                      name="mode"
                      value="general"
                      checked={mode === 'general'}
                      onChange={() => setMode('general')}
                    />
                    <span>Viewer</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="radio"
                      name="mode"
                      value="streamer"
                      checked={mode === 'streamer'}
                      onChange={() => setMode('streamer')}
                    />
                    <span>Streamer</span>
                  </label>
                </div>
              </div>

              {showStreamerPanels && (
                <div id="keyword-panel" className="keyword-panel">
                  <label htmlFor="keyword-input">Streamer keywords</label>
                  <input
                    id="keyword-input"
                    type="text"
                    placeholder="funny, multikill, clutch"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                  />
                  <p className="hint">Add comma-separated keywords to tag moments for clips.</p>
                  <label htmlFor="keyword-threshold">Keyword match threshold</label>
                  <div className="slider-row">
                    <input
                      id="keyword-threshold"
                      type="range"
                      min="1"
                      max="4"
                      step="1"
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                    <span id="keyword-threshold-value" className="pill">{threshold}</span>
                  </div>
                  <p className="hint">Increase to require repeated mentions before logging a timestamp.</p>
                </div>
              )}

              <div className="actions">
                <button type="submit" className="primary">Start summarizing</button>
                <button type="button" className="ghost" onClick={handleReset}>Reset</button>
              </div>
            </form>
            <div className="status-row">
              <span id="status-pill" className="pill">{status}</span>
              {videoId ? (
                <span id="video-pill" className="pill">Video ID: {videoId}</span>
              ) : null}
              {updatedLabel ? (
                <span id="updated-pill" className="pill">{updatedLabel}</span>
              ) : null}
            </div>
            {error ? (
              <p id="error-text" className="status error">{error}</p>
            ) : null}
          </div>

          <aside className="card side-panel">
            <h2>Video info</h2>
            <div className="side-item">
              <span className="side-label">Title</span>
              <span id="video-title" className={`side-value ${!videoTitle ? 'muted' : ''}`}>
                {videoTitle || 'Waiting...'}
              </span>
            </div>
            <div className="side-item">
              <span className="side-label">Channel</span>
              <span id="video-channel" className={`side-value ${!videoChannel ? 'muted' : ''}`}>
                {videoChannel || 'Waiting...'}
              </span>
            </div>
          </aside>
        </section>

        <section className="card summary-box">
          <h2>Summary</h2>
          <div id="summary-content" className={`summary-content ${summaryItems.length ? '' : 'muted'}`}>
            {summaryItems.length ? (
              <ul>
                {summaryItems.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            ) : (
              'Paste a livestream link to begin. Summaries refresh automatically once the backend starts streaming.'
            )}
          </div>
        </section>

        {showStreamerPanels ? (
          <section id="history-panel" className="card summary-box">
            <h2>Summary history</h2>
            <div id="history-content" className={`summary-content ${history.length ? 'history-content' : 'muted'}`}>
              {history.length ? (
                <ul>
                  {[...history]
                    .reverse()
                    .map((entry, idx) => {
                      const summaryText = typeof entry.summary === 'string' ? entry.summary : ''
                      const timestamp = entry.timestamp
                        ? new Date(entry.timestamp * 1000).toLocaleTimeString()
                        : 'Unknown time'
                      return (
                        <li key={idx}>{`${timestamp} - ${summaryText.replace(/\n/g, ' ')}`}</li>
                      )
                    })}
                </ul>
              ) : (
                'Summaries will appear here as they update.'
              )}
            </div>
          </section>
        ) : null}

        {showStreamerPanels ? (
          <section id="events-panel" className="card summary-box">
            <h2>Keyword timestamps</h2>
            <div id="events-content" className={`summary-content ${events.length ? '' : 'muted'}`}>
              {events.length ? (
                <ul>
                  {events.map((event, idx) => {
                    const time = typeof event.timestamp === 'string' && event.timestamp
                      ? event.timestamp
                      : 'Unknown time'
                    return (
                      <li key={`${event.keyword || 'tag'}-${idx}`}>
                        {`${time} - ${event.keyword || 'tag'}`}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                'Add keywords in streamer mode to start logging timestamps.'
              )}
            </div>
          </section>
        ) : null}

        <section className="card summary-box">
          <h2>Chat frequency</h2>
          <div className="chart-actions">
            <button type="button" className="ghost small" onClick={handleZoomOut}>- Zoom out</button>
            <button type="button" className="ghost small" onClick={handleZoomIn}>+ Zoom in</button>
            <button type="button" className="ghost small" onClick={handleResetZoom}>Reset</button>
          </div>
          <div className="chart-container">
            <canvas id="rate-chart" ref={canvasRef} />
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
