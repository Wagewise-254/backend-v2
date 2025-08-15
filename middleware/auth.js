// backend/middleware/auth.js
import supabase from '../libs/supabaseClient.js'

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]; // Extract token from "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  try {
    // Verify the token with the Supabase auth service
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    // Attach the user ID to the request object
    req.userId = data.user.id;
    next();
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(500).json({ error: 'Authentication failed.' });
  }
};

export default verifyToken;