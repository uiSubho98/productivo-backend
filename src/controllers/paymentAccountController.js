import PaymentAccount from '../models/PaymentAccount.js';

export const create = async (req, res) => {
  try {
    const {
      accountName, type, bankName, accountNumber, ifscCode,
      accountHolderName, upiId, qrImageUrl, isDefault, organizationId,
    } = req.body;

    const orgId = req.user.role === 'product_owner' && organizationId
      ? organizationId
      : req.user.organizationId;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        error: 'Organization ID is required.',
      });
    }

    // If this is set as default, unset other defaults for the org
    if (isDefault) {
      await PaymentAccount.updateMany(
        { organizationId: orgId, isDefault: true },
        { isDefault: false }
      );
    }

    const account = await PaymentAccount.create({
      organizationId: orgId,
      accountName,
      type,
      bankName,
      accountNumber,
      ifscCode,
      accountHolderName,
      upiId,
      qrImageUrl,
      isDefault: isDefault || false,
    });

    return res.status(201).json({
      success: true,
      data: account,
      message: 'Payment account created.',
    });
  } catch (error) {
    console.error('Create payment account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create payment account.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    const orgId = req.user.role === 'product_owner' && req.query.organizationId
      ? req.query.organizationId
      : req.user.organizationId;

    const accounts = await PaymentAccount.find({
      organizationId: orgId,
      isActive: true,
    }).sort({ isDefault: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: accounts,
    });
  } catch (error) {
    console.error('Get payment accounts error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch payment accounts.',
    });
  }
};

export const getById = async (req, res) => {
  try {
    const orgId = req.user.role === 'product_owner' ? undefined : req.user.organizationId;
    const filter = { _id: req.params.id, isActive: true };
    if (orgId) filter.organizationId = orgId;

    const account = await PaymentAccount.findOne(filter);

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Payment account not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: account,
    });
  } catch (error) {
    console.error('Get payment account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch payment account.',
    });
  }
};

export const update = async (req, res) => {
  try {
    const {
      accountName, type, bankName, accountNumber, ifscCode,
      accountHolderName, upiId, qrImageUrl,
    } = req.body;

    const updateData = {};
    if (accountName !== undefined) updateData.accountName = accountName;
    if (type !== undefined) updateData.type = type;
    if (bankName !== undefined) updateData.bankName = bankName;
    if (accountNumber !== undefined) updateData.accountNumber = accountNumber;
    if (ifscCode !== undefined) updateData.ifscCode = ifscCode;
    if (accountHolderName !== undefined) updateData.accountHolderName = accountHolderName;
    if (upiId !== undefined) updateData.upiId = upiId;
    if (qrImageUrl !== undefined) updateData.qrImageUrl = qrImageUrl;

    const orgId = req.user.role === 'product_owner' ? undefined : req.user.organizationId;
    const filter = { _id: req.params.id, isActive: true };
    if (orgId) filter.organizationId = orgId;

    const account = await PaymentAccount.findOneAndUpdate(
      filter,
      updateData,
      { new: true, runValidators: true }
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Payment account not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: account,
      message: 'Payment account updated.',
    });
  } catch (error) {
    console.error('Update payment account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update payment account.',
    });
  }
};

export const remove = async (req, res) => {
  try {
    const orgId = req.user.role === 'product_owner' ? undefined : req.user.organizationId;
    const filter = { _id: req.params.id, isActive: true };
    if (orgId) filter.organizationId = orgId;

    const account = await PaymentAccount.findOneAndUpdate(
      filter,
      { isActive: false },
      { new: true }
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Payment account not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Payment account deleted.',
    });
  } catch (error) {
    console.error('Delete payment account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete payment account.',
    });
  }
};

export const setDefault = async (req, res) => {
  try {
    const orgId = req.user.role === 'product_owner' ? undefined : req.user.organizationId;
    const filter = { _id: req.params.id, isActive: true };
    if (orgId) filter.organizationId = orgId;

    const account = await PaymentAccount.findOne(filter);

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Payment account not found.',
      });
    }

    // Unset all defaults for this org
    await PaymentAccount.updateMany(
      { organizationId: account.organizationId, isDefault: true },
      { isDefault: false }
    );

    // Set this one as default
    account.isDefault = true;
    await account.save();

    return res.status(200).json({
      success: true,
      data: account,
      message: 'Default payment account updated.',
    });
  } catch (error) {
    console.error('Set default payment account error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to set default payment account.',
    });
  }
};
