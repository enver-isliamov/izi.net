import { supabase } from '../services/supabase';

export async function adminOnly(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authentication Required' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

  if (authErr || !user) return res.status(401).json({ error: 'Invalid Session' });

  if (user.email === 'enverphoto@gmail.com') {
    req.user = { ...user, role: 'superadmin' };
    return next();
  }

  // Проверяем и role (из users), и is_admin (из profiles) для надежности
  const [userRes, profileRes] = await Promise.all([
    supabase.from('users').select('role').eq('id', user.id).maybeSingle(),
    supabase.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  ]);

  const isAdmin = userRes.data?.role === 'admin' || userRes.data?.role === 'superadmin' || profileRes.data?.is_admin === true;

  if (!isAdmin) {
    console.warn(`👮 [Auth] Доступ запрещен для ${user.email}`);
    return res.status(403).json({ error: 'Insufficient Permissions' });
  }

  req.user = user;
  next();
}

export async function authenticateUser(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth required' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}
