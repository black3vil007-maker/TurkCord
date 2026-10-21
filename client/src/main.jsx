import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('CRITICAL REACT CRASH:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, background: '#161b22', color: '#ff7b72', fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ maxWidth: 600, width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 16, padding: 24, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <h2 style={{ color: '#f85149', fontSize: 18, fontWeight: 'bold', margin: '0 0 12px 0' }}>
              ⚠️ Uygulama Hatası Oluştu
            </h2>
            <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 12 }}>
              Sayfa yüklenirken bir bileşen hatası yakalandı. Detaylar aşağıdadır:
            </p>
            <pre style={{ background: '#161b22', border: '1px solid #30363d', padding: 12, borderRadius: 8, whiteSpace: 'pre-wrap', color: '#f0f6fc', fontSize: 12, overflowX: 'auto', maxHeight: 200 }}>
              {this.state.error?.toString()}
            </pre>
            <button
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              style={{ padding: '8px 16px', background: '#238636', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', marginTop: 16, fontWeight: 'bold', fontSize: 13 }}
            >
              Önbelleği Temizle & Yeniden Başlat
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
