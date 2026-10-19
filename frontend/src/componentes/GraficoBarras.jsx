// Gráfico de barras dos indicadores (RF12, UC12 passo 11).
//
// Decisões visuais, seguindo a referência de visualização de dados do projeto:
//   - uma única série por gráfico, então **não há legenda**: o título já diz o que é;
//   - cor única, vinda do token `--cor-grafico` — a cor identifica a série, nunca o
//     ranking da barra, para a leitura não mudar quando os dados mudarem. O token tem
//     um valor por tema, cada um validado contra a superfície correspondente;
//   - marcas finas, topo arredondado em 4px preso à base, e espaço entre as barras;
//   - grade e eixos discretos, valor escrito na ponta da barra (rótulo direto);
//   - tooltip no passar do mouse, e a mesma informação também em tabela, logo abaixo
//     de cada gráfico, para quem usa leitor de tela ou não enxerga a cor.
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { corDoTema, useTema } from '../tema/ContextoTema.jsx';

function Dica({ active, payload, label, sufixo, descricao }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  return (
    <div className="grafico-dica">
      <p className="sem-margem">
        <strong>{item.rotuloCompleto ?? label}</strong>
      </p>
      <p className="sem-margem">
        {payload[0].value}
        {sufixo}
        {descricao ? ` ${descricao}` : ''}
      </p>
    </div>
  );
}

export function GraficoBarras({
  dados,
  chaveRotulo = 'rotulo',
  chaveValor = 'valor',
  sufixo = '',
  descricaoDica = '',
  maximo,
  altura = 260,
  titulo,
}) {
  // O Recharts recebe a cor como valor, não como CSS: relemos os tokens a cada troca
  // de tema (o `escuro` na dependência é justamente o gatilho).
  const { escuro } = useTema();
  const cores = useMemo(
    () => ({
      serie: corDoTema('--cor-grafico', '#2a6fd4'),
      realce: corDoTema('--cor-grafico-suave', 'rgb(42 111 212 / 10%)'),
      grade: corDoTema('--cor-grade', '#e4e9f0'),
      eixo: corDoTema('--cor-texto-suave', '#55606e'),
      rotulo: corDoTema('--cor-texto', '#16212e'),
      borda: corDoTema('--cor-borda', '#dbe2ea'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [escuro],
  );

  if (!dados || dados.length === 0) return null;

  return (
    <div className="grafico" role="img" aria-label={titulo}>
      <ResponsiveContainer width="100%" height={altura}>
        <BarChart data={dados} margin={{ top: 18, right: 12, left: 0, bottom: 4 }} barCategoryGap="28%">
          {/* Grade discreta: só na horizontal, para guiar o olho sem competir com as barras. */}
          <CartesianGrid vertical={false} stroke={cores.grade} />
          <XAxis
            dataKey={chaveRotulo}
            tick={{ fontSize: 12, fill: cores.eixo }}
            tickLine={false}
            axisLine={{ stroke: cores.borda }}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 12, fill: cores.eixo }}
            tickLine={false}
            axisLine={false}
            domain={[0, maximo ?? 'auto']}
            allowDecimals={false}
            width={44}
          />
          <Tooltip
            cursor={{ fill: cores.realce }}
            content={<Dica sufixo={sufixo} descricao={descricaoDica} />}
          />
          <Bar dataKey={chaveValor} fill={cores.serie} radius={[4, 4, 0, 0]} maxBarSize={56}>
            {/* Rótulo direto na ponta: dispensa contar linhas da grade. */}
            <LabelList
              dataKey={chaveValor}
              position="top"
              formatter={(v) => `${v}${sufixo}`}
              style={{ fill: cores.rotulo, fontSize: 12, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
