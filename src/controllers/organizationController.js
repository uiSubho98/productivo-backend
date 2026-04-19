import bcrypt from 'bcryptjs';
import Organization from '../models/Organization.js';
import User from '../models/User.js';

export const create = async (req, res) => {
  try {
    const { name, logo, cinNumber, taxPercentage, address, phone, website, parentOrgId } = req.body;

    // Determine superadminId:
    // - superadmin creating their first (master) org: they are the superadmin owner
    // - superadmin adding a child org: look up parent org's superadminId
    // - product_owner: no superadminId
    let resolvedSuperadminId = null;
    let resolvedParentOrgId = null;

    if (req.user.role === 'superadmin' || (!req.user.organizationId && req.user.role !== 'product_owner')) {
      resolvedSuperadminId = req.user._id;
    } else if (req.user.role !== 'product_owner' && req.user.organizationId) {
      // org_admin creating a child org under superadmin's tree
      const parentOrg = await Organization.findById(req.user.organizationId);
      resolvedSuperadminId = parentOrg?.superadminId || null;
      resolvedParentOrgId = req.user.organizationId;
    }

    // Block superadmin from creating a second master org on free plan
    if (req.user.role === 'superadmin' && !parentOrgId && req.user.organizationId) {
      return res.status(403).json({ success: false, error: 'You already have a master organization. Upgrade to Pro to create sub-organizations.' });
    }

    // If parentOrgId explicitly provided by a superadmin, validate ownership
    if (parentOrgId && req.user.role === 'superadmin') {
      const parentOrg = await Organization.findById(parentOrgId);
      if (!parentOrg) {
        return res.status(404).json({ success: false, error: 'Parent organization not found.' });
      }
      if (parentOrg.superadminId?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, error: 'You can only create child orgs under your own organizations.' });
      }
      resolvedParentOrgId = parentOrgId;
    }

    const organization = await Organization.create({
      name,
      logo,
      cinNumber,
      taxPercentage,
      address,
      phone,
      website,
      adminIds: [req.user._id],
      superadminId: resolvedSuperadminId,
      parentOrgId: resolvedParentOrgId,
    });

    // product_owner stays product_owner with no org; everyone else becomes superadmin (org-scoped) or org_admin
    if (req.user.role !== 'product_owner') {
      const newRole = req.user.role === 'superadmin' ? 'superadmin' : 'org_admin';
      await User.findByIdAndUpdate(req.user._id, {
        organizationId: organization._id,
        role: newRole,
      });
    }

    return res.status(201).json({
      success: true,
      data: organization,
      message: 'Organization created.',
    });
  } catch (error) {
    console.error('Create organization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create organization.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    const user = req.user;
    const filter = {};

    if (user.role === 'product_owner') {
      // product_owner sees all organizations — scoped to superadmin if ?superadminId= provided
      if (req.query.superadminId) {
        filter.superadminId = req.query.superadminId;
      }
    } else if (user.role === 'superadmin') {
      // superadmin sees all orgs they own (master + child orgs)
      filter.superadminId = user._id;
    } else if (user.organizationId) {
      // org_admin, employee: only their own org
      filter._id = user.organizationId;
    } else {
      filter.adminIds = user._id;
    }

    const organizations = await Organization.find(filter).populate('adminIds', 'name email').populate('superadminId', 'name email');

    const orgIds = organizations.map((o) => o._id);
    const memberCounts = await User.aggregate([
      { $match: { organizationId: { $in: orgIds }, role: { $nin: ['product_owner', 'superadmin'] } } },
      { $group: { _id: '$organizationId', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(memberCounts.map((m) => [m._id.toString(), m.count]));

    const data = organizations.map((org) => ({
      ...org.toObject(),
      memberCount: countMap[org._id.toString()] || 0,
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Get organizations error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch organizations.',
    });
  }
};

export const getById = async (req, res) => {
  try {
    if (req.user.role !== 'product_owner') {
      // superadmin can view any org they own (master or child)
      if (req.user.role === 'superadmin') {
        const org = await Organization.findById(req.params.id).select('superadminId parentOrgId');
        const isOwnOrg = req.user.organizationId?.toString() === req.params.id;
        const isOwnedOrg = org?.superadminId?.toString() === req.user._id.toString();
        if (!isOwnOrg && !isOwnedOrg) {
          return res.status(403).json({ success: false, error: 'Access denied.' });
        }
      } else if (req.user.organizationId?.toString() !== req.params.id) {
        // org_admin / employee can only see their own org
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }
    }

    const organization = await Organization.findById(req.params.id).populate(
      'adminIds',
      'name email'
    );

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: organization,
    });
  } catch (error) {
    console.error('Get organization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch organization.',
    });
  }
};

export const update = async (req, res) => {
  try {
    // Non-product_owner can only update their own org
    if (req.user.role !== 'product_owner' && req.user.organizationId?.toString() !== req.params.id) {
      return res.status(403).json({ success: false, error: 'You can only update your own organization.' });
    }

    const { name, logo, cinNumber, taxPercentage, address, phone, website } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (logo !== undefined) updateData.logo = logo;
    if (cinNumber !== undefined) updateData.cinNumber = cinNumber;
    if (taxPercentage !== undefined) updateData.taxPercentage = taxPercentage;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (website !== undefined) updateData.website = website;
    // canViewInvoices can only be set by the owning superadmin or product_owner
    if (req.body.canViewInvoices !== undefined && (req.user.role === 'superadmin' || req.user.role === 'product_owner')) {
      updateData.canViewInvoices = req.body.canViewInvoices;
    }

    const organization = await Organization.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: organization,
      message: 'Organization updated.',
    });
  } catch (error) {
    console.error('Update organization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update organization.',
    });
  }
};

export const getMembers = async (req, res) => {
  try {
    if (req.user.role !== 'product_owner') {
      if (req.user.role === 'superadmin') {
        const org = await Organization.findById(req.params.id).select('superadminId');
        const isOwnOrg = req.user.organizationId?.toString() === req.params.id;
        const isOwnedOrg = org?.superadminId?.toString() === req.user._id.toString();
        if (!isOwnOrg && !isOwnedOrg) {
          return res.status(403).json({ success: false, error: 'Access denied.' });
        }
      } else if (req.user.organizationId?.toString() !== req.params.id) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }
    }

    const members = await User.find({
      organizationId: req.params.id,
    }).select('-passwordHash -mpinHash');

    return res.status(200).json({
      success: true,
      data: members,
    });
  } catch (error) {
    console.error('Get members error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch members.',
    });
  }
};

export const addMember = async (req, res) => {
  try {
    const { email, name, password, role, phoneNumber } = req.body;
    const { id: orgId } = req.params;

    // Phone number is mandatory for all new members
    const phone = (phoneNumber || '').toString().trim();
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phone || phoneDigits.length < 10 || phoneDigits.length > 15) {
      return res.status(400).json({
        success: false,
        error: 'A valid phone number (10–15 digits) is required.',
      });
    }

    // Phone must be unique across all users
    const phoneDup = await User.findOne({ phoneNumber: phone }).select('_id email').lean();
    if (phoneDup && (!email || phoneDup.email !== email.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: 'This phone number is already registered to another user.',
      });
    }

    // Non-product_owner can only add members to their own org
    if (req.user.role !== 'product_owner' && req.user.organizationId?.toString() !== orgId) {
      return res.status(403).json({ success: false, error: 'You can only add members to your own organization.' });
    }

    const assignRole = role === 'org_admin' ? 'org_admin' : 'employee';

    // Rule: org must have at least 1 org_admin before employees can be added
    if (assignRole === 'employee') {
      const requestingUserIsAdmin = ['org_admin', 'superadmin', 'product_owner'].includes(req.user.role);
      if (!requestingUserIsAdmin) {
        const orgAdminCount = await User.countDocuments({
          organizationId: orgId,
          role: 'org_admin',
        });
        if (orgAdminCount === 0) {
          return res.status(400).json({
            success: false,
            error: 'Organization must have at least 1 admin before adding employees. Add an admin first.',
          });
        }
      }
    }

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (user.organizationId && user.organizationId.toString() !== orgId) {
        return res.status(400).json({
          success: false,
          error: 'User already belongs to another organization.',
        });
      }

      // If the existing user has no phone, backfill from the form value
      const updates = { organizationId: orgId, role: assignRole };
      if (!user.phoneNumber) updates.phoneNumber = phone;
      await User.findByIdAndUpdate(user._id, updates);

      return res.status(200).json({
        success: true,
        message: `${user.name || user.email} added as ${assignRole}.`,
      });
    }

    // New user — create account
    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required for new members.',
      });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    user = await User.create({
      name: name || email.split('@')[0],
      email: email.toLowerCase(),
      passwordHash,
      role: assignRole,
      organizationId: orgId,
      phoneNumber: phone,
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: `Account created for ${user.name} as ${assignRole}. They can login with their email and password.`,
    });
  } catch (error) {
    console.error('Add member error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add member.',
    });
  }
};

export const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const requester = req.user;

    const org = await Organization.findById(id);
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    // Non-product_owner can only delete their own org
    if (requester.role !== 'product_owner' && requester.organizationId?.toString() !== id) {
      return res.status(403).json({ success: false, error: 'You can only delete your own organization.' });
    }

    await Organization.findByIdAndDelete(id);

    // Clear org membership for all non-owner users in this org
    await User.updateMany(
      { organizationId: id, role: { $nin: ['product_owner'] } },
      { $set: { organizationId: null, role: 'employee' } }
    );

    return res.status(200).json({ success: true, message: 'Organization deleted.' });
  } catch (error) {
    console.error('Delete organization error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete organization.' });
  }
};

export const removeMember = async (req, res) => {
  try {
    const { id: orgId, userId } = req.params;
    const requester = req.user;

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Can't remove yourself
    if (targetUser._id.toString() === requester._id.toString()) {
      return res.status(400).json({ success: false, error: 'You cannot remove yourself.' });
    }

    // Can't remove a product_owner or superadmin from their org
    if (targetUser.role === 'product_owner') {
      return res.status(403).json({ success: false, error: 'Cannot remove product owner.' });
    }
    if (targetUser.role === 'superadmin' && requester.role !== 'product_owner') {
      return res.status(403).json({ success: false, error: 'Only product owner can remove superadmin accounts.' });
    }

    // product_owner can remove anyone from any org
    if (requester.role === 'product_owner') {
      await User.findByIdAndUpdate(userId, { organizationId: null, role: 'employee' });
      return res.status(200).json({ success: true, message: `${targetUser.name} removed from organization.` });
    }

    // superadmin/org_admin can only remove members of their own org
    if (requester.role === 'superadmin' || requester.role === 'org_admin') {
      if (!targetUser.organizationId || targetUser.organizationId.toString() !== orgId) {
        return res.status(403).json({ success: false, error: 'User does not belong to this organization.' });
      }
      // Verify requester belongs to same org
      if (requester.organizationId?.toString() !== orgId) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      // org_admin can't remove other org admins — only superadmin of same org can
      if (targetUser.role === 'org_admin' && requester.role === 'org_admin') {
        return res.status(403).json({ success: false, error: 'Only superadmin can remove org admins.' });
      }

      await User.findByIdAndUpdate(userId, { organizationId: null, role: 'employee' });
      return res.status(200).json({ success: true, message: `${targetUser.name} removed from organization.` });
    }

    return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
  } catch (error) {
    console.error('Remove member error:', error);
    return res.status(500).json({ success: false, error: 'Failed to remove member.' });
  }
};

/**
 * PATCH /api/v1/organizations/:id/invoice-permission
 * Superadmin (owner of this org tree) or product_owner can toggle canViewInvoices.
 */
/**
 * GET /api/v1/organizations/tree
 * Returns org hierarchy scoped to the caller's role:
 *   - product_owner: every superadmin as a top-level node, each with their org tree
 *   - superadmin:    their own orgs as a single tree rooted at the master org
 *   - org_admin:     just their own org (flat, 1-node)
 */
export const getOrgTree = async (req, res) => {
  try {
    const user = req.user;

    // Helper: given a list of orgs, return root nodes with nested `children`.
    const buildTree = (orgs) => {
      const byId = new Map();
      const childrenByParent = new Map();
      for (const o of orgs) {
        byId.set(String(o._id), { ...o, children: [] });
      }
      for (const o of orgs) {
        const parent = o.parentOrgId ? String(o.parentOrgId) : null;
        if (parent && byId.has(parent)) {
          byId.get(parent).children.push(byId.get(String(o._id)));
        } else {
          if (!childrenByParent.has('ROOT')) childrenByParent.set('ROOT', []);
          childrenByParent.get('ROOT').push(byId.get(String(o._id)));
        }
      }
      return childrenByParent.get('ROOT') || [];
    };

    // Helper: enrich each org with member counts + admin names
    const enrichOrgs = async (orgs) => {
      const orgIds = orgs.map((o) => o._id);
      const memberCounts = await User.aggregate([
        { $match: { organizationId: { $in: orgIds }, isActive: true } },
        { $group: { _id: { orgId: '$organizationId', role: '$role' }, count: { $sum: 1 } } },
      ]);
      const countMap = {};
      for (const row of memberCounts) {
        const k = String(row._id.orgId);
        if (!countMap[k]) countMap[k] = { total: 0, org_admin: 0, employee: 0, superadmin: 0 };
        countMap[k].total += row.count;
        countMap[k][row._id.role] = row.count;
      }
      return orgs.map((o) => ({
        ...o,
        memberCounts: countMap[String(o._id)] || { total: 0, org_admin: 0, employee: 0, superadmin: 0 },
      }));
    };

    if (user.role === 'product_owner') {
      // All superadmins → each as a top-level node with their org tree
      const superadmins = await User.find({ role: 'superadmin', isActive: true })
        .select('name email')
        .sort({ name: 1 })
        .lean();
      const allOrgs = await Organization.find({})
        .select('name superadminId parentOrgId logo')
        .sort({ name: 1 })
        .lean();
      const enriched = await enrichOrgs(allOrgs);

      const rootNodes = superadmins.map((sa) => {
        const orgsOfSA = enriched.filter((o) => String(o.superadminId) === String(sa._id));
        return {
          kind: 'superadmin',
          id: sa._id,
          name: sa.name,
          email: sa.email,
          orgs: buildTree(orgsOfSA),
        };
      });

      // Orphaned orgs (no matching superadmin) — rare but show them
      const orphanedOrgs = enriched.filter((o) => !o.superadminId);
      if (orphanedOrgs.length) {
        rootNodes.push({
          kind: 'orphan',
          name: 'Orphaned (no superadmin)',
          orgs: buildTree(orphanedOrgs),
        });
      }
      return res.status(200).json({ success: true, data: { scope: 'platform', roots: rootNodes } });
    }

    if (user.role === 'superadmin') {
      const orgs = await Organization.find({ superadminId: user._id })
        .select('name superadminId parentOrgId logo')
        .sort({ name: 1 })
        .lean();
      const enriched = await enrichOrgs(orgs);
      return res.status(200).json({
        success: true,
        data: {
          scope: 'superadmin',
          roots: [
            {
              kind: 'superadmin',
              id: user._id,
              name: user.name,
              email: user.email,
              orgs: buildTree(enriched),
            },
          ],
        },
      });
    }

    if (user.role === 'org_admin' && user.organizationId) {
      const org = await Organization.findById(user.organizationId)
        .select('name superadminId parentOrgId logo')
        .lean();
      if (!org) return res.status(200).json({ success: true, data: { scope: 'org', roots: [] } });
      const enriched = await enrichOrgs([org]);
      return res.status(200).json({
        success: true,
        data: {
          scope: 'org',
          roots: [
            {
              kind: 'org',
              orgs: enriched.map((o) => ({ ...o, children: [] })),
            },
          ],
        },
      });
    }

    return res.status(403).json({ success: false, error: 'Not authorised.' });
  } catch (err) {
    console.error('getOrgTree error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load org tree.' });
  }
};

export const updateInvoicePermission = async (req, res) => {
  try {
    const { id } = req.params;
    const { canViewInvoices } = req.body;

    if (typeof canViewInvoices !== 'boolean') {
      return res.status(400).json({ success: false, error: 'canViewInvoices must be a boolean.' });
    }

    const org = await Organization.findById(id);
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    // Only the owning superadmin or product_owner may change this
    if (req.user.role === 'superadmin' && org.superadminId?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'You can only manage permissions for your own organizations.' });
    }
    if (req.user.role !== 'superadmin' && req.user.role !== 'product_owner') {
      return res.status(403).json({ success: false, error: 'Only superadmin or product owner can change invoice permissions.' });
    }

    org.canViewInvoices = canViewInvoices;
    await org.save();

    return res.status(200).json({
      success: true,
      data: { canViewInvoices: org.canViewInvoices },
      message: `Invoice access ${canViewInvoices ? 'granted' : 'revoked'} for this organization.`,
    });
  } catch (error) {
    console.error('Update invoice permission error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update invoice permission.' });
  }
};
