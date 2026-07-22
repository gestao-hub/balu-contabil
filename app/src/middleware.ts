// Middleware minimalista: apenas propaga o pathname atual via header `x-pathname`
// para que Server Components (ex.: `(auth)/layout.tsx`) possam ler a rota corrente
// sem depender de client-side navigation. Usado pelo gate de re-aceite de LGPD
// (Task 12) para evitar loop de redirect em `/aceite`. Sem lógica de auth aqui.
import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Cobre as rotas do app; exclui assets estáticos, imagens do Next e API routes
  // (a API não precisa do gate de re-aceite e não deve pagar o custo do middleware).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
