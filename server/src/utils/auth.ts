import { supabase } from '../services/supabase';

export async function adminOnly(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication Required' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

  if (authErr || !user) {
    return res.status(401).json({ error: 'Invalid Session' });
  }

  // Спец-доступ для владельца
  if (user.email === 'enverphoto@gmail.com') {
    req.user = { ...user, role: 'superadmin' };
    return next();
  }

  // Проверка через таблицу public.users (согласно Supabase.md)
  const { data: dbUser, error: dbError } = await supabase
    .from('users')
    .select('role, email')
    .eq('id', user.id)
    .maybeSingle();

  if (dbError || !dbUser) {
    console.error('👮 [Auth] Ошибка проверки прав через таблицу users:', dbError?.message);
    return res.status(403).json({ error: 'User record not found' });
  }

  if (dbUser.role !== 'admin' && dbUser.role !== 'superadmin') {
    console.warn(`👮 [Auth] Отказ в доступе: ${user.email} (роль: ${dbUser.role})`);
    return res.status(403).json({ error: 'Insufficient Permissions' });
  }

  req.user = { ...user, role: dbUser.role };
  next();
}

export async function authenticateUser(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth required' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}
