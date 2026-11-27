import React, { useEffect, useState } from 'react';
import { CheckCircle2, Edit3, KeyRound, MapPin, Plus, Star, Trash2, User } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { CustomerAddress, CustomerUser, Lang } from '../types';

const LABELS: Record<
  Lang,
  {
    profileTitle: string;
    basicInfo: string;
    name: string;
    email: string;
    phone: string;
    prefLang: string;
    saveProfile: string;
    profileSaved: string;
    addressesTitle: string;
    addressHint: string;
    lastOrderPriority: string;
    defaultBadge: string;
    lastOrderBadge: string;
    setDefault: string;
    edit: string;
    del: string;
    addAddress: string;
    limitReached: string;
    labelPlaceholder: string;
    addressPlaceholder: string;
    postcodePlaceholder: string;
    recipientPlaceholder: string;
    phonePlaceholder: string;
    saveAddress: string;
    cancel: string;
    changePassword: string;
    currentPass: string;
    newPass: string;
    updatePass: string;
    passUpdated: string;
  }
> = {
  en: {
    profileTitle: 'Account Profile',
    basicInfo: 'Basic Information',
    name: 'Full Name',
    email: 'Email / Gmail',
    phone: 'Phone Number',
    prefLang: 'Preferred Language',
    saveProfile: 'Save Basic Info',
    profileSaved: 'Profile updated successfully.',
    addressesTitle: 'Saved Delivery Addresses',
    addressHint: 'You can save up to 5 addresses. At checkout, your last order delivery address is automatically prioritized first.',
    lastOrderPriority: 'Next Checkout Priority (Last Order):',
    defaultBadge: 'Default',
    lastOrderBadge: 'Last Ordered',
    setDefault: 'Set Default',
    edit: 'Edit',
    del: 'Delete',
    addAddress: 'Add New Address',
    limitReached: 'Maximum of 5 saved addresses reached. Delete or edit an existing address.',
    labelPlaceholder: 'Label (e.g. Home, Office)',
    addressPlaceholder: 'Full street address, unit / condo name',
    postcodePlaceholder: 'Postcode (e.g. 43000)',
    recipientPlaceholder: 'Recipient Name',
    phonePlaceholder: 'Contact Phone',
    saveAddress: 'Save Address',
    cancel: 'Cancel',
    changePassword: 'Change Password',
    currentPass: 'Current Password',
    newPass: 'New Password (min 6 chars)',
    updatePass: 'Update Password',
    passUpdated: 'Password updated successfully.',
  },
  'zh-CN': {
    profileTitle: '个人资料设置',
    basicInfo: '基础信息',
    name: '姓名',
    email: '邮箱 / Gmail',
    phone: '电话号码',
    prefLang: '偏好语言',
    saveProfile: '保存基础信息',
    profileSaved: '基础资料已更新。',
    addressesTitle: '收货地址簿',
    addressHint: '最多可保存 5 个地址。每次点单时系统会自动优先选择您上次历史订单使用的地址。',
    lastOrderPriority: '下次点单默认优先地址（上次订单）：',
    defaultBadge: '默认地址',
    lastOrderBadge: '上次下单',
    setDefault: '设为默认',
    edit: '编辑',
    del: '删除',
    addAddress: '新增收货地址',
    limitReached: '已达到最多 5 个保存地址上限，请删除或编辑现有地址。',
    labelPlaceholder: '标签（如：家、公司）',
    addressPlaceholder: '详细街道地址 / 门牌 / 公寓名',
    postcodePlaceholder: '邮编（如 43000）',
    recipientPlaceholder: '收货人姓名',
    phonePlaceholder: '联系电话',
    saveAddress: '保存地址',
    cancel: '取消',
    changePassword: '修改密码',
    currentPass: '当前密码',
    newPass: '新密码（至少 6 位）',
    updatePass: '更新密码',
    passUpdated: '密码修改成功。',
  },
  'ms-MY': {
    profileTitle: 'Profil Akaun',
    basicInfo: 'Maklumat Asas',
    name: 'Nama Penuh',
    email: 'E-mel / Gmail',
    phone: 'Nombor Telefon',
    prefLang: 'Bahasa Pilihan',
    saveProfile: 'Simpan Maklumat',
    profileSaved: 'Profil berjaya dikemas kini.',
    addressesTitle: 'Buku Alamat Penghantaran',
    addressHint: 'Sehingga 5 alamat boleh disimpan. Semasa pembayaran, alamat pesanan terakhir anda akan diutamakan secara automatik.',
    lastOrderPriority: 'Keutamaan Pembayaran Seterusnya (Pesanan Terakhir):',
    defaultBadge: 'Utama',
    lastOrderBadge: 'Pesanan Terakhir',
    setDefault: 'Jadikan Utama',
    edit: 'Sunting',
    del: 'Padam',
    addAddress: 'Tambah Alamat Baru',
    limitReached: 'Had maksimum 5 alamat disimpan telah dicapai.',
    labelPlaceholder: 'Label (cth: Rumah, Pejabat)',
    addressPlaceholder: 'Alamat penuh, unit / kondominium',
    postcodePlaceholder: 'Poskod (cth: 43000)',
    recipientPlaceholder: 'Nama Penerima',
    phonePlaceholder: 'No. Telefon',
    saveAddress: 'Simpan Alamat',
    cancel: 'Batal',
    changePassword: 'Tukar Kata Laluan',
    currentPass: 'Kata Laluan Semasa',
    newPass: 'Kata Laluan Baru (min 6 aksara)',
    updatePass: 'Kemas Kini Kata Laluan',
    passUpdated: 'Kata laluan berjaya dikemas kini.',
  },
};

export const CustomerProfilePanel: React.FC<{
  customer: CustomerUser;
  lang: Lang;
  onCustomerUpdated: (cust: CustomerUser) => void;
  onSwitchToOrders: () => void;
}> = ({ customer, lang, onCustomerUpdated, onSwitchToOrders }) => {
  const L = LABELS[lang];
  const addresses = customer.addresses || [];

  const [basicForm, setBasicForm] = useState({
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    preferredLang: (customer.preferredLang || lang) as Lang,
  });
  const [basicMsg, setBasicMsg] = useState('');
  const [basicErr, setBasicErr] = useState('');
  const [savingBasic, setSavingBasic] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAddrId, setEditingAddrId] = useState<number | null>(null);
  const [addrForm, setAddrForm] = useState({
    label: 'Home',
    recipientName: customer.name,
    phone: customer.phone,
    address: '',
    postcode: '43000',
    isDefault: false,
  });
  const [addrErr, setAddrErr] = useState('');
  const [savingAddr, setSavingAddr] = useState(false);

  const [passForm, setPassForm] = useState({ currentPassword: '', newPassword: '' });
  const [passMsg, setPassMsg] = useState('');
  const [passErr, setPassErr] = useState('');

  useEffect(() => {
    setBasicForm({
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      preferredLang: (customer.preferredLang || lang) as Lang,
    });
  }, [customer, lang]);

  const handleSaveBasic = async (e: React.FormEvent) => {
    e.preventDefault();
    setBasicErr('');
    setBasicMsg('');
    setSavingBasic(true);
    try {
      const res = await apiFetch<{ customer: CustomerUser }>('/api/customer/profile', {
        method: 'PUT',
        body: JSON.stringify(basicForm),
      });
      onCustomerUpdated(res.customer);
      setBasicMsg(L.profileSaved);
    } catch (err) {
      setBasicErr(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSavingBasic(false);
    }
  };

  const openAddAddress = () => {
    setEditingAddrId(null);
    setAddrErr('');
    setAddrForm({
      label: addresses.length === 0 ? 'Home' : `Address ${addresses.length + 1}`,
      recipientName: customer.name,
      phone: customer.phone,
      address: '',
      postcode: '43000',
      isDefault: addresses.length === 0,
    });
    setShowAddForm(true);
  };

  const openEditAddress = (addr: CustomerAddress) => {
    setShowAddForm(false);
    setEditingAddrId(addr.id);
    setAddrErr('');
    setAddrForm({
      label: addr.label,
      recipientName: addr.recipientName || customer.name,
      phone: addr.phone || customer.phone,
      address: addr.address,
      postcode: addr.postcode,
      isDefault: addr.isDefault,
    });
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddrErr('');
    setSavingAddr(true);
    try {
      if (editingAddrId !== null) {
        const res = await apiFetch<{ customer: CustomerUser }>(`/api/customer/addresses/${editingAddrId}`, {
          method: 'PATCH',
          body: JSON.stringify(addrForm),
        });
        onCustomerUpdated(res.customer);
        setEditingAddrId(null);
      } else {
        const res = await apiFetch<{ customer: CustomerUser }>('/api/customer/addresses', {
          method: 'POST',
          body: JSON.stringify(addrForm),
        });
        onCustomerUpdated(res.customer);
        setShowAddForm(false);
      }
    } catch (err) {
      setAddrErr(err instanceof Error ? err.message : 'Failed to save address.');
    } finally {
      setSavingAddr(false);
    }
  };

  const handleSetDefault = async (addrId: number) => {
    setAddrErr('');
    try {
      const res = await apiFetch<{ customer: CustomerUser }>(`/api/customer/addresses/${addrId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      });
      onCustomerUpdated(res.customer);
    } catch (err) {
      setAddrErr(err instanceof Error ? err.message : 'Failed to update default address.');
    }
  };

  const handleDeleteAddress = async (addrId: number) => {
    setAddrErr('');
    try {
      const res = await apiFetch<{ customer: CustomerUser }>(`/api/customer/addresses/${addrId}`, {
        method: 'DELETE',
      });
      onCustomerUpdated(res.customer);
    } catch (err) {
      setAddrErr(err instanceof Error ? err.message : 'Failed to delete address.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassErr('');
    setPassMsg('');
    try {
      await apiFetch('/api/customer/change-password', {
        method: 'POST',
        body: JSON.stringify(passForm),
      });
      setPassForm({ currentPassword: '', newPassword: '' });
      setPassMsg(L.passUpdated);
    } catch (err) {
      setPassErr(err instanceof Error ? err.message : 'Failed to update password.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      {/* Header & Quick Tab Switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold text-stone-900 flex items-center gap-2">
          <User className="w-5 h-5 text-[#075E40]" />
          {L.profileTitle}
        </h2>
        <button
          type="button"
          onClick={onSwitchToOrders}
          className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-[#075E40] text-xs font-bold hover:bg-emerald-100"
        >
          {lang === 'zh-CN' ? '查看我的订单 →' : lang === 'ms-MY' ? 'Lihat Pesanan Saya →' : 'View My Orders →'}
        </button>
      </div>

      {/* Basic Info */}
      <form onSubmit={handleSaveBasic} className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold text-stone-900">{L.basicInfo}</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">{L.name}</label>
            <input
              required
              value={basicForm.name}
              onChange={(e) => setBasicForm({ ...basicForm, name: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">{L.email}</label>
            <input
              required
              type="email"
              value={basicForm.email}
              onChange={(e) => setBasicForm({ ...basicForm, email: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">{L.phone}</label>
            <input
              required
              value={basicForm.phone}
              onChange={(e) => setBasicForm({ ...basicForm, phone: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">{L.prefLang}</label>
            <select
              value={basicForm.preferredLang}
              onChange={(e) => setBasicForm({ ...basicForm, preferredLang: e.target.value as Lang })}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
              <option value="ms-MY">Bahasa Melayu</option>
            </select>
          </div>
        </div>
        {basicErr && <div className="text-xs text-red-600 font-medium">{basicErr}</div>}
        {basicMsg && (
          <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> {basicMsg}
          </div>
        )}
        <button
          type="submit"
          disabled={savingBasic}
          className="px-5 py-2 rounded-xl bg-[#075E40] hover:bg-emerald-900 text-white text-sm font-bold disabled:opacity-50"
        >
          {L.saveProfile}
        </button>
      </form>

      {/* Saved Addresses (Up to 5) */}
      <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#075E40]" />
              {L.addressesTitle} ({addresses.length} / 5)
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">{L.addressHint}</p>
          </div>
          <button
            type="button"
            disabled={addresses.length >= 5}
            onClick={openAddAddress}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#075E40] hover:bg-emerald-900 text-white text-xs font-bold disabled:bg-stone-300 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" /> {L.addAddress}
          </button>
        </div>

        {customer.preferredCheckoutAddress?.source === 'last_order' && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
            <span className="font-bold">{L.lastOrderPriority}</span>{' '}
            <span>
              {customer.preferredCheckoutAddress.address}, {customer.preferredCheckoutAddress.postcode}
            </span>
          </div>
        )}

        {addresses.length >= 5 && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            {L.limitReached}
          </div>
        )}

        {addrErr && <div className="text-xs text-red-600 font-medium">{addrErr}</div>}

        {(showAddForm || editingAddrId !== null) && (
          <form onSubmit={handleSaveAddress} className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
            <div className="grid sm:grid-cols-3 gap-2.5">
              <input
                required
                value={addrForm.label}
                onChange={(e) => setAddrForm({ ...addrForm, label: e.target.value })}
                placeholder={L.labelPlaceholder}
                className="px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
              />
              <input
                value={addrForm.recipientName}
                onChange={(e) => setAddrForm({ ...addrForm, recipientName: e.target.value })}
                placeholder={L.recipientPlaceholder}
                className="px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
              />
              <input
                value={addrForm.phone}
                onChange={(e) => setAddrForm({ ...addrForm, phone: e.target.value })}
                placeholder={L.phonePlaceholder}
                className="px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
              />
            </div>
            <div className="grid sm:grid-cols-3 gap-2.5">
              <input
                required
                value={addrForm.address}
                onChange={(e) => setAddrForm({ ...addrForm, address: e.target.value })}
                placeholder={L.addressPlaceholder}
                className="sm:col-span-2 px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
              />
              <input
                required
                value={addrForm.postcode}
                onChange={(e) => setAddrForm({ ...addrForm, postcode: e.target.value })}
                placeholder={L.postcodePlaceholder}
                className="px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
              <input
                type="checkbox"
                checked={addrForm.isDefault}
                onChange={(e) => setAddrForm({ ...addrForm, isDefault: e.target.checked })}
                className="rounded border-stone-300 text-[#075E40]"
              />
              {L.setDefault}
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingAddr}
                className="px-4 py-2 rounded-xl bg-[#075E40] text-white text-xs font-bold disabled:opacity-50"
              >
                {L.saveAddress}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingAddrId(null);
                }}
                className="px-4 py-2 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 bg-white"
              >
                {L.cancel}
              </button>
            </div>
          </form>
        )}

        <div className="space-y-2.5">
          {addresses.length === 0 ? (
            <p className="text-sm text-stone-500 py-2">
              {lang === 'zh-CN'
                ? '暂未保存地址，点击右上角「新增收货地址」最多可添加 5 个。'
                : 'No saved addresses yet. Add up to 5 delivery addresses above.'}
            </p>
          ) : (
            addresses.map((addr) => {
              const isLastOrderMatch =
                customer.preferredCheckoutAddress?.source === 'last_order' &&
                customer.preferredCheckoutAddress.address.trim().toLowerCase() === addr.address.trim().toLowerCase();
              return (
                <div
                  key={addr.id}
                  className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/70 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-stone-900">{addr.label}</span>
                      {addr.isDefault && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-[#075E40] text-[10px] font-bold">
                          {L.defaultBadge}
                        </span>
                      )}
                      {isLastOrderMatch && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                          {L.lastOrderBadge}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-stone-700">
                      {addr.address}, {addr.postcode}
                    </div>
                    {(addr.recipientName || addr.phone) && (
                      <div className="text-[11px] text-stone-500">
                        {addr.recipientName} {addr.phone ? `· ${addr.phone}` : ''}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    {!addr.isDefault && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(addr.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 font-medium"
                      >
                        <Star className="w-3 h-3" /> {L.setDefault}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditAddress(addr)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 font-medium"
                    >
                      <Edit3 className="w-3 h-3" /> {L.edit}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAddress(addr.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 font-medium"
                    >
                      <Trash2 className="w-3 h-3" /> {L.del}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Change Password */}
      <form onSubmit={handleChangePassword} className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 shadow-sm space-y-4">
        <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[#075E40]" />
          {L.changePassword}
        </h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <input
            required
            type="password"
            value={passForm.currentPassword}
            onChange={(e) => setPassForm({ ...passForm, currentPassword: e.target.value })}
            placeholder={L.currentPass}
            className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
          />
          <input
            required
            type="password"
            minLength={6}
            value={passForm.newPassword}
            onChange={(e) => setPassForm({ ...passForm, newPassword: e.target.value })}
            placeholder={L.newPass}
            className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
          />
        </div>
        {passErr && <div className="text-xs text-red-600 font-medium">{passErr}</div>}
        {passMsg && (
          <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> {passMsg}
          </div>
        )}
        <button
          type="submit"
          className="px-5 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold"
        >
          {L.updatePass}
        </button>
      </form>
    </div>
  );
};
