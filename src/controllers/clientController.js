import Client from '../models/Client.js';

export const create = async (req, res) => {
  try {
    const {
      name, email, whatsappNumber, phoneNumber, address,
      companyName, logo, gstNumber, cinNumber, pipelineStage, source, website, countryCode,
      addressLat, addressLng,
      organizationId: bodyOrgId,
    } = req.body;

    // Superadmin can specify org; org_admin uses their own org
    const organizationId = req.user.role === 'superadmin' && bodyOrgId
      ? bodyOrgId
      : req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'organizationId is required.' });
    }

    const client = await Client.create({
      name,
      email: email || null,
      whatsappNumber: whatsappNumber || null,
      phoneNumber: phoneNumber || null,
      address: address ? { ...address, country: 'India' } : undefined,
      organizationId,
      companyName,
      logo,
      gstNumber,
      cinNumber,
      pipelineStage,
      source,
      website,
      countryCode,
      addressLat: addressLat || null,
      addressLng: addressLng || null,
    });

    return res.status(201).json({
      success: true,
      data: client,
      message: 'Client created.',
    });
  } catch (error) {
    console.error('Create client error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(409).json({
        success: false,
        error: field === 'email' ? 'A client with this email already exists.' : 'A client with this phone number already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to create client.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    const { organizationId: queryOrgId } = req.query;
    const filter = req.user.role === 'superadmin'
      ? (queryOrgId ? { organizationId: queryOrgId } : {})
      : { organizationId: req.user.organizationId };
    const clients = await Client.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: clients,
    });
  } catch (error) {
    console.error('Get clients error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch clients.',
    });
  }
};

export const getById = async (req, res) => {
  try {
    const filter = req.user.role === 'superadmin'
      ? { _id: req.params.id }
      : { _id: req.params.id, organizationId: req.user.organizationId };
    const client = await Client.findOne(filter).populate('notes.createdBy', 'name email');

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Client not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: client,
    });
  } catch (error) {
    console.error('Get client error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch client.',
    });
  }
};

export const update = async (req, res) => {
  try {
    const {
      name, email, whatsappNumber, phoneNumber, address,
      companyName, logo, gstNumber, cinNumber, pipelineStage, source, website, countryCode,
      addressLat, addressLng,
    } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (whatsappNumber !== undefined) updateData.whatsappNumber = whatsappNumber;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (address !== undefined) updateData.address = { ...address, country: 'India' };
    if (companyName !== undefined) updateData.companyName = companyName;
    if (logo !== undefined) updateData.logo = logo;
    if (gstNumber !== undefined) updateData.gstNumber = gstNumber;
    if (cinNumber !== undefined) updateData.cinNumber = cinNumber;
    if (pipelineStage !== undefined) updateData.pipelineStage = pipelineStage;
    if (source !== undefined) updateData.source = source;
    if (website !== undefined) updateData.website = website;
    if (countryCode !== undefined) updateData.countryCode = countryCode;
    if (addressLat !== undefined) updateData.addressLat = addressLat || null;
    if (addressLng !== undefined) updateData.addressLng = addressLng || null;

    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Client not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: client,
      message: 'Client updated.',
    });
  } catch (error) {
    console.error('Update client error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(409).json({
        success: false,
        error: field === 'email' ? 'A client with this email already exists.' : 'A client with this phone number already exists.',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to update client.',
    });
  }
};

export const remove = async (req, res) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role !== 'superadmin') filter.organizationId = req.user.organizationId;

    const client = await Client.findOneAndDelete(filter);

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Client not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Client deleted.',
    });
  } catch (error) {
    console.error('Delete client error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete client.',
    });
  }
};

export const updatePipelineStage = async (req, res) => {
  try {
    const { pipelineStage } = req.body;

    if (!pipelineStage) {
      return res.status(400).json({
        success: false,
        error: 'pipelineStage is required.',
      });
    }

    const filter = req.user.role === 'superadmin'
      ? { _id: req.params.id }
      : { _id: req.params.id, organizationId: req.user.organizationId };

    const client = await Client.findOneAndUpdate(
      filter,
      { pipelineStage },
      { new: true, runValidators: true }
    );

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Client not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: client,
      message: 'Pipeline stage updated.',
    });
  } catch (error) {
    console.error('Update pipeline stage error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update pipeline stage.',
    });
  }
};

export const addNote = async (req, res) => {
  try {
    const { text, content } = req.body;
    const noteText = text || content;

    if (!noteText) {
      return res.status(400).json({
        success: false,
        error: 'Note text is required.',
      });
    }

    const noteFilter = req.user.role === 'superadmin'
      ? { _id: req.params.id }
      : { _id: req.params.id, organizationId: req.user.organizationId };

    const client = await Client.findOneAndUpdate(
      noteFilter,
      {
        $push: {
          notes: {
            text: noteText,
            createdBy: req.user._id,
            createdAt: new Date(),
          },
        },
      },
      { new: true, runValidators: true }
    ).populate('notes.createdBy', 'name email');

    if (!client) {
      return res.status(404).json({
        success: false,
        error: 'Client not found.',
      });
    }

    return res.status(201).json({
      success: true,
      data: client,
      message: 'Note added.',
    });
  } catch (error) {
    console.error('Add note error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add note.',
    });
  }
};

export const getByPipeline = async (req, res) => {
  try {
    const { organizationId: queryOrgId } = req.query;
    const filter = req.user.role === 'superadmin'
      ? (queryOrgId ? { organizationId: queryOrgId } : {})
      : { organizationId: req.user.organizationId };
    const clients = await Client.find(filter).sort({ createdAt: -1 });

    const stages = ['lead', 'contacted', 'quotation_sent', 'quotation_revised', 'mvp_shared', 'converted', 'lost'];
    const grouped = {};

    stages.forEach((stage) => {
      grouped[stage] = [];
    });

    clients.forEach((client) => {
      const stage = client.pipelineStage || 'lead';
      if (grouped[stage]) {
        grouped[stage].push(client);
      }
    });

    return res.status(200).json({
      success: true,
      data: grouped,
    });
  } catch (error) {
    console.error('Get by pipeline error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch clients by pipeline.',
    });
  }
};
