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

  if (user.email === 'enverphoto@gmail.com') {
    req.user = { ...user, role: 'superadmin' };
    return next();
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role, email')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return res.status(403).json({ error: 'Profile Error' });
  }

  if (profile.role !== 'admin' && profile.role !== 'superadmin') {
    return res.status(403).json({ error: 'Insufficient Permissions' });
  }

  req.user = { ...user, role: profile.role };
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
