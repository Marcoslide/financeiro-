'use client';

import { useAuth } from '@/lib/auth';
import { ROLE_LABEL } from '@/lib/format';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p>Bem-vindo, {user?.name} · perfil {user ? ROLE_LABEL[user.role] : ''}</p>
        </div>
      </div>

      <div className="info-banner">
        ℹ <b>Base do sistema (Bloco 1).</b> Ainda não há dados financeiros — a importação dos
        relatórios da Shopee e a conciliação chegam nos próximos blocos. Os indicadores abaixo
        ficam zerados até a primeira importação.
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="lbl">Entradas na carteira</div><div className="val">R$ 0,00</div><div className="sub">sem importações ainda</div></div>
        <div className="kpi"><div className="lbl">% Conciliado</div><div className="val">—</div><div className="sub">disponível no Bloco 4</div></div>
        <div className="kpi"><div className="lbl">Pendências abertas</div><div className="val">0</div><div className="sub">disponível no Bloco 5</div></div>
        <div className="kpi"><div className="lbl">Valor não explicado</div><div className="val">R$ 0,00</div><div className="sub">sem dados</div></div>
      </div>

      <div className="panel">
        <div className="ph"><h3>Próximos passos</h3></div>
        <div className="pb">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li><b>Bloco 2 — Importação:</b> upload e leitura de CSV/XLS/XLSX com deduplicação.</li>
            <li><b>Bloco 3 — Pedidos e eventos:</b> carteira, Acelera, afiliados, devoluções.</li>
            <li><b>Bloco 4 — Conciliação:</b> motor determinístico e ficha financeira por pedido.</li>
            <li><b>Bloco 5 — Pendências</b> e <b>Bloco 6 — Dashboard/Relatórios</b>.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
