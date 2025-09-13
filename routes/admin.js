const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { protect, authorize } = require('../middleware/authMiddleware');

const User = require('../models/UserModel');
const Order = require('../models/OrderModel');
const Task = require('../models/Task');

const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  updateUserRole,
  getAllTasks,
  createTask,
  getAllOrders
} = require('../controllers/adminController');

// ================= PUBLIC ROUTES (No authentication) =================

// Check if admin exists
router.get('/admin-exists', async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ role: 'admin' });
    res.json({ adminExists: adminCount > 0 });
  } catch (error) {
    console.error('Admin exists check error:', error);
    res.status(500).json({ error: 'Failed to check admin existence' });
  }
});

// Register admin
router.post('/register-admin', async (req, res) => {
  try {
    const { name, email, password, secretKey } = req.body;

    // Check if admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      return res.status(403).json({ 
        success: false,
        error: 'Admin account already exists. Only one admin allowed.' 
      });
    }

    // Validate secret key
    const expectedSecretKey = process.env.ADMIN_SECRET_KEY || 'ADMIN_SETUP_2024';
    if (secretKey !== expectedSecretKey) {
      return res.status(403).json({ 
        success: false,
        error: 'Invalid admin setup key' 
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: 'User with this email already exists' 
      });
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash(password, 12);
    const adminUser = new User({
      name,
      email,
      password: hashedPassword,
      role: 'admin',
      isVerified: true
    });

    await adminUser.save();

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully',
      user: {
        id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role
      }
    });

  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create admin account: ' + error.message 
    });
  }
});

// Get admin count (public for initial setup check)
router.get('/admins/count', async (req, res) => {
  try {
    const adminCount = await User.countDocuments({ role: 'admin' });
    res.json({ success: true, count: adminCount });
  } catch (error) {
    console.error('Error counting admins:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ================= PROTECTED ROUTES (Require admin authentication) =================
router.use(protect);
router.use(authorize('admin'));

// User management routes
router.route('/users')
  .get(getAllUsers)
  .post(createUser);

router.route('/users/:id')
  .get(getUserById)
  .put(updateUser)
  .delete(deleteUser);

router.put('/users/:id/role', updateUserRole);

// Task management routes
router.route('/tasks')
  .get(getAllTasks)
  .post(createTask);

// Order management routes
router.get('/orders', getAllOrders);

// Dashboard statistics
router.get('/dashboard/stats', async (req, res) => {
  try {
    const [
      totalUsers,
      totalOrders,
      pendingOrders,
      completedOrders,
      totalTasks,
      pendingTasks
    ] = await Promise.all([
      User.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
      Order.countDocuments({ status: 'completed' }),
      Task.countDocuments(),
      Task.countDocuments({ status: 'pending' })
    ]);

    res.json({
      success: true,
      data: {
        users: totalUsers,
        orders: {
          total: totalOrders,
          pending: pendingOrders,
          completed: completedOrders
        },
        tasks: {
          total: totalTasks,
          pending: pendingTasks
        }
      }
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch dashboard statistics' 
    });
  }
});

// Order status update
router.put('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'processing', 'completed', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
      });
    }

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('user', 'name email phone');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (err) {
    console.error('Order status update error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update order status' 
    });
  }
});

module.exports = router;