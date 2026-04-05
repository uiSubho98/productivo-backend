import Enquiry from '../models/Enquiry.js';

// POST /api/v1/enquiries — public, no auth required
export const createEnquiry = async (req, res) => {
  try {
    const { fullName, email, phone, description } = req.body;
    if (!fullName || !email || !phone || !description) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }
    const enquiry = await Enquiry.create({ fullName, email, phone, description });
    return res.status(201).json({ success: true, data: enquiry });
  } catch (err) {
    console.error('createEnquiry error:', err);
    return res.status(500).json({ success: false, error: 'Failed to save enquiry.' });
  }
};

// GET /api/v1/enquiries — protected, superadmin + org_admin only
export const getEnquiries = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = status ? { status } : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [enquiries, total] = await Promise.all([
      Enquiry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Enquiry.countDocuments(filter),
    ]);
    return res.status(200).json({ success: true, data: enquiries, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('getEnquiries error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch enquiries.' });
  }
};

// PATCH /api/v1/enquiries/:id — update status/notes
export const updateEnquiry = async (req, res) => {
  try {
    const { status, notes } = req.body;
    const enquiry = await Enquiry.findByIdAndUpdate(
      req.params.id,
      { ...(status && { status }), ...(notes !== undefined && { notes }) },
      { new: true }
    );
    if (!enquiry) return res.status(404).json({ success: false, error: 'Enquiry not found.' });
    return res.status(200).json({ success: true, data: enquiry });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update enquiry.' });
  }
};
