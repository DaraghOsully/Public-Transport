import React, { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, AreaChart, Area
} from 'recharts'

// --- Types (informal JS-style) ---
// We keep JS (not TS) for simplicity.

// --- Utility helpers ---
function downloadBlob(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function parseCsv(text) {
  const rows = text
    .split(/\r?\n/)
    .filter((r) => r.trim().length > 0)
    .map((line) => {
      const out = []
      let cur = ''
      let inQ = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else { inQ = !inQ }
        } else if (c === ',' && !inQ) { out.push(cur); cur = '' }
        else { cur += c }
      }
      out.push(cur)
      return out
    })
  const headers = rows[0]
  const data = rows.slice(1).map((r) => Object.fromEntries(r.map((v, i) => [headers[i], v])))
  return { headers, data }
}

function linearRegression(points) {
  const n = points.length
  if (n < 2) return { a: 0, b: 0 }
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const b = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const a = sumY / n - (b * sumX) / n
  return { a, b }
}

function projectLinear(history, toYear) {
  const pts = history.map((d) => ({ x: d.year, y: d.value }))
  const { a, b } = linearRegression(pts)
  const lastYear = Math.max(...history.map((d) => d.year))
  const out = []
  for (let y = lastYear + 1; y <= toYear; y++) out.push({ year: y, value: a + b * y })
  return out
}

function projectCAGR(history, toYear) {
  if (history.length < 2) return []
  const first = history[0]
  const last = history[history.length - 1]
  const years = last.year - first.year
  if (years <= 0 || first.value <= 0) return []
  const cagr = Math.pow(last.value / first.value, 1 / years) - 1
  const out = []
  for (let y = last.year + 1; y <= toYear; y++) {
    const t = y - first.year
    out.push({ year: y, value: first.value * Math.pow(1 + cagr, t) })
  }
  return out
}

export default function App() {
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [tableCode, setTableCode] = useState('THA25')
  const [series, setSeries] = useState([]) // [{year, mode1, mode2,...}]
  const [modeFilters, setModeFilters] = useState(['Public transport', 'Bus', 'Train, DART or LUAS'])
  const [projectionKind, setProjectionKind] = useState('linear') // 'linear' | 'cagr'
  const [projectionToYear, setProjectionToYear] = useState(2035)

  async function fetchPxStatTHA25(code) {
    setStatus('fetching'); setError('')

    const endpoint = 'https://ws.cso.ie/public/api.jsonrpc'
    const payload = {
      jsonrpc: '2.0',
      method: 'PxStat.Data.Cube_API.ReadDataset',
      params: { class: 'PX', id: code, dimension: null },
      id: 1,
    }
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json = await res.json()
      if (!json.result) throw new Error('No result in PxStat response')

      const dim = json.result.dimension
      const dimKeys = Object.keys(dim.dimension)
      const categories = dimKeys.map((k) => ({ key: k, ...dim.dimension[k] }))

      const catArrays = categories.map((c) => {
        const pairs = Object.entries(c.category.index).sort((a,b) => a[1]-b[1])
        return pairs.map(([code, idx]) => ({ code, idx, label: c.category.label[code] }))
      })

      const timeKey = (dim.role.time && dim.role.time[0]) || dimKeys.find((k) => /time|year/i.test(k)) || dimKeys[dimKeys.length - 1]
      const sizes = dim.size
      const matrix = Array.isArray(json.result.value[0]) ? json.result.value.flat() : json.result.value

      const strides = []
      let acc = 1
      for (let i = sizes.length - 1; i >= 0; i--) { strides[i] = acc; acc *= sizes[i] }
      function idxOf(indices) { return indices.reduce((sum, v, i) => sum + v * strides[i], 0) }

      const dimVals = catArrays.map((arr) => arr.map((x) => x.label))
      const rows = []
      for (let i0 = 0; i0 < sizes[0]; i0++) {
        for (let i1 = 0; i1 < (sizes[1] ?? 1); i1++) {
          for (let i2 = 0; i2 < (sizes[2] ?? 1); i2++) {
            for (let i3 = 0; i3 < (sizes[3] ?? 1); i3++) {
              const idx = idxOf([i0,i1,i2,i3].slice(0, sizes.length))
              const val = matrix[idx]
              const rec = {}
              ;[i0,i1,i2,i3].slice(0, sizes.length).forEach((vi, di) => {
                const key = dimKeys[di]
                rec[key] = dimVals[di][vi]
              })
              rec['value'] = val
              rows.push(rec)
            }
          }
        }
      }

      const geoKey = dimKeys.find((k) => /geo|county|region|stat(e)?|area|location/i.test(k)) || dimKeys[0]
      const modeKey = dimKeys.find((k) => /means|mode|method|travel|transport/i.test(k)) || dimKeys[1]
      const yearKey = timeKey

      const possibleAll = ['State','All','State Total','Ireland','State - Total']
      const geos = Array.from(new Set(rows.map((r) => r[geoKey])))
      const chosenGeo = geos.find((g) => possibleAll.includes(g)) || geos[0]

      const years = Array.from(new Set(rows.map((r) => parseInt(String(r[yearKey]),10)))).sort((a,b)=>a-b)
      const modes = Array.from(new Set(rows.map((r) => r[modeKey])))
      const defaultModes = modes.filter((m) => /public|bus|train|dart|luas/i.test(String(m)))
      const selected = defaultModes.length ? defaultModes : modes.slice(0,3)
      setModeFilters(selected)

      const table = years.map((y) => {
        const row = { year: y }
        selected.forEach((m) => {
          const rec = rows.find((r) => r[geoKey] === chosenGeo && r[modeKey] === m && parseInt(String(r[yearKey]),10) === y)
          row[m] = typeof rec?.value === 'number' ? rec.value : NaN
        })
        return row
      })
      setSeries(table)
      setStatus('ready')
    } catch (e) {
      console.error(e)
      setError('Failed to read ' + code + ' from PxStat: ' + (e.message || e))
      setStatus('error')
    }
  }

  function onCsvUpload(file) {
    setStatus('parsing'); setError('')
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result || '')
        const { headers, data } = parseCsv(text)
        const yearKey = headers.find((h) => /year|time|census/i.test(h)) || headers[headers.length - 1]
        const geoKey = headers.find((h) => /geo|county|region|state|area|location/i.test(h)) || headers[0]
        const modeKey = headers.find((h) => /means|mode|method|travel|transport/i.test(h)) || headers[1]
        const valKey = headers.find((h) => /value|obs|number|count|persons/i.test(h)) || headers[headers.length - 1]

        const geos = Array.from(new Set(data.map((r) => r[geoKey])))
        const chosenGeo = geos.find((g) => ['State','Ireland','State Total'].includes(String(g))) || geos[0]
        const years = Array.from(new Set(data.map((r) => Number(r[yearKey])))).sort((a,b)=>a-b)
        const modes = Array.from(new Set(data.map((r) => r[modeKey])))
        const defaultModes = modes.filter((m) => /public|bus|train|dart|luas/i.test(String(m)))
        const selected = (defaultModes.length ? defaultModes : modes.slice(0,3))
        setModeFilters(selected)

        const table = years.map((y) => {
          const row = { year: y }
          selected.forEach((m) => {
            const rec = data.find((r) => String(r[geoKey]) === String(chosenGeo) && String(r[modeKey]) === String(m) && Number(r[yearKey]) === y)
            row[m] = rec ? Number(rec[valKey]) : NaN
          })
          return row
        })
        setSeries(table)
        setStatus('ready')
      } catch (e) {
        setError('CSV parse failed: ' + (e.message || e))
        setStatus('error')
      }
    }
    reader.onerror = () => { setError('Failed to read CSV file'); setStatus('error') }
    reader.readAsText(file)
  }

  const publicTransportCombined = useMemo(() => {
    if (!series.length) return []
    const yearKeys = series.map((r) => r.year)
    return yearKeys.map((year) => {
      const row = series.find((r) => r.year === year)
      const sum = Object.entries(row)
        .filter(([k]) => k !== 'year')
        .filter(([k]) => modeFilters.includes(k))
        .reduce((s, [,v]) => s + (typeof v === 'number' ? v : 0), 0)
      return { year, value: sum }
    })
  }, [series, modeFilters])

  const projection = useMemo(() => {
    if (!publicTransportCombined.length) return []
    const lastYear = publicTransportCombined[publicTransportCombined.length - 1].year
    const to = Math.max(projectionToYear, lastYear + 1)
    return projectionKind === 'linear'
      ? projectLinear(publicTransportCombined, to)
      : projectCAGR(publicTransportCombined, to)
  }, [publicTransportCombined, projectionKind, projectionToYear])

  useEffect(() => { fetchPxStatTHA25(tableCode) }, [])

  const hasData = series.length > 0

  const allModeKeys = hasData ? Object.keys(series[0]).filter((k) => k !== 'year') : []

  return (
    <div className="container">
      <div className="header">
        <div>
          <div className="title">Ireland Public Transport Usage – THA25 Explorer</div>
          <div className="muted">Pulls THA25 from CSO PxStat, or upload a THA25 CSV export. Visualizes usage & simple projections.</div>
        </div>
        <button className="btn" onClick={() => fetchPxStatTHA25(tableCode)}>Refresh</button>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <label className="label">PxStat Table Code</label>
            <input className="input" value={tableCode} onChange={(e) => setTableCode(e.target.value)} placeholder="THA25" />
            <button className="btn" style={{marginTop:8}} onClick={() => fetchPxStatTHA25(tableCode)}>Load from CSO PxStat</button>
            {status === 'fetching' && <div className="muted" style={{marginTop:8}}>Fetching from PxStat…</div>}
            {error && <div style={{marginTop:8, color:'#b91c1c', fontSize:12}}>{error}</div>}
          </div>
          <div>
            <label className="label">Upload THA25 CSV (fallback)</label>
            <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files && onCsvUpload(e.target.files[0])} />
            <div className="muted" style={{marginTop:8}}>Use CSO.ie → THA25 → Download CSV.</div>
          </div>
          <div>
            <label className="label">Projection</label>
            <select className="select" value={projectionKind} onChange={(e) => setProjectionKind(e.target.value)}>
              <option value="linear">Linear Trend</option>
              <option value="cagr">CAGR (through last point)</option>
            </select>
            <div style={{display:'flex', gap:8, alignItems:'center', marginTop:8}}>
              <input className="input" type="number" value={projectionToYear} onChange={(e) => setProjectionToYear(parseInt(e.target.value || '2035', 10))} min={2025} />
              <span className="muted">to year</span>
            </div>
          </div>
        </div>
        <div className="row" style={{marginTop:12, alignItems:'end'}}>
          <div>
            <div className="label">Included Modes (toggle by clicking legend below)</div>
            <div className="legend">Detected public-transport-like modes are included by default.</div>
          </div>
          <div style={{textAlign:'right'}}>
            <button className="btn btn-outline" onClick={() => { if (!series.length) return; setModeFilters(allModeKeys) }}>Select All Modes</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="title" style={{fontSize:18, marginBottom:8}}>Historical & Current – Selected Modes</div>
        {hasData ? (
          <div style={{height:320}}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip />
                <Legend onClick={(e) => {
                  const key = e.dataKey
                  setModeFilters((prev) => prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key])
                }} />
                {allModeKeys.map((k) => <Line key={k} type="monotone" dataKey={k} dot={false} strokeWidth={2} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="muted">Load data to view chart.</div>}
      </div>

      <div className="card">
        <div className="title" style={{fontSize:18, marginBottom:8}}>Stacked – Combined Public Transport vs Others</div>
        {hasData ? (
          <div style={{height:320}}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series.map((r) => ({
                year: r.year,
                publicTransport: Object.entries(r).filter(([k]) => k !== 'year').filter(([k]) => modeFilters.includes(k)).reduce((s, [,v]) => s + (typeof v === 'number' ? v : 0), 0),
                other: Object.entries(r).filter(([k]) => k !== 'year').filter(([k]) => !modeFilters.includes(k)).reduce((s, [,v]) => s + (typeof v === 'number' ? v : 0), 0),
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="publicTransport" stackId="1" strokeWidth={2} />
                <Area type="monotone" dataKey="other" stackId="1" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="muted">Load data to view chart.</div>}
      </div>

      <div className="card">
        <div className="title" style={{fontSize:18, marginBottom:8}}>Projection – Combined Public Transport</div>
        {publicTransportCombined.length ? (
          <div style={{height:320}}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...publicTransportCombined, ...projection]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="value" strokeWidth={2} name="Historical (sum of selected modes)" dot={false} />
                {projection.length ? (
                  <Line type="monotone" dataKey="proj" strokeWidth={2} dot={false}
                        data={projection.map((d) => ({ ...d, proj: d.value }))}
                        name={"Projection (" + projectionKind.toUpperCase() + ")"} />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="muted">Load data first to generate projections.</div>}
      </div>

      <div className="card">
        <div className="title" style={{fontSize:18, marginBottom:8}}>Data Table</div>
        {hasData ? (
          <div style={{overflowX:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  {allModeKeys.map((k) => <th key={k}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {series.map((row) => (
                  <tr key={row.year}>
                    <td>{row.year}</td>
                    {allModeKeys.map((k) => <td key={k}>{Number(row[k]).toLocaleString()}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{marginTop:12, display:'flex', gap:8}}>
              <button className="btn btn-outline"
                      onClick={() => downloadBlob('tha25_export.json', JSON.stringify({ series }, null, 2))}>
                Export JSON
              </button>
            </div>
          </div>
        ) : <div className="muted">No data loaded yet.</div>}
      </div>

      <div className="muted" style={{marginTop:12}}>
        Source: Central Statistics Office (CSO) Ireland, PxStat table <b>{tableCode}</b> (THA25). If API fails, download THA25 CSV from CSO.ie and upload it here. Projections are exploratory only.
      </div>
    </div>
  )
}
