// Mensagem de erro ou de sucesso do formulário inteiro (RNF06).
// `role="alert"` para erros (interrompe e anuncia) e `role="status"` para sucessos.
export function Aviso({ tipo = 'erro', children }) {
  if (!children) return null;
  return (
    <p className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
