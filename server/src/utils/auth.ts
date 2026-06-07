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

  // Проверка через таблицу profiles (согласно схеме БД)
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_admin, email')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile) {
    console.error('👮 [Auth] Ошибка проверки прав админа:', profileError?.message);
    return res.status(403).json({ error: 'Profile not found or error' });
  }

  if (profile.is_admin !== true) {
    console.warn(`👮 [Auth] Отказ в доступе: ${user.email} не является админом`);
    return res.status(403).json({ error: 'Insufficient Permissions' });
  }

  req.user = { ...user, role: 'admin' };
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
