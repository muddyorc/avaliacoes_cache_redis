// P-24 — o estudante cancela a própria inscrição na turma.
//
// A ação aparece em mais de um lugar (cartão da tela inicial, lista de turmas e a tela
// da turma), e a pergunta da confirmação precisa ser a mesma em todos: é ela que explica
// o que muda. Por isso mora aqui, e não copiada em cada tela.
import { useState } from 'react';
import { api } from '../api/client.js';
import { IconeSairTurma } from './Icones.jsx';
import { MenuAcoes } from './MenuAcoes.jsx';

function pergunta(turma) {
  if (turma.situacao === 'PENDENTE') return `Cancelar sua solicitação para "${turma.nome}"?`;
  return (
    `Cancelar sua inscrição em "${turma.nome}"?\n\n` +
    'Você deixa de ver as provas desta turma. As provas que já fez continuam registradas ' +
    'com o professor, e você pode voltar depois com o código de acesso.'
  );
}

// `aoSair(mensagem)` recebe o texto do servidor — cada tela decide onde mostrá-lo e o
// que fazer com a turma que saiu da lista.
export function CancelarInscricao({ turma, aoSair, aoFalhar }) {
  const [saindo, setSaindo] = useState(false);
  const pendente = turma.situacao === 'PENDENTE';

  async function cancelar() {
    if (!window.confirm(pergunta(turma))) return;
    setSaindo(true);
    try {
      const resposta = await api(`/estudante/turmas/${turma.id}/sair`, { metodo: 'POST' });
      aoSair?.(resposta.mensagem, turma);
    } catch (falha) {
      aoFalhar?.(falha.message);
    } finally {
      setSaindo(false);
    }
  }

  return (
    <MenuAcoes rotulo={`Ações da turma ${turma.nome}`}>
      <button className="menu-item" role="menuitem" type="button" disabled={saindo} onClick={cancelar}>
        <IconeSairTurma className="icone" />
        {pendente ? 'Cancelar solicitação' : 'Cancelar inscrição'}
      </button>
    </MenuAcoes>
  );
}
