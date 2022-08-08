#include <gtest/gtest.h>

template <typename T>
class TypedTestP : public testing::Test
{
};

TYPED_TEST_SUITE_P(TypedTestP);

TYPED_TEST_P(TypedTestP, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST_P(TypedTestP, HasPropertyA)
{
    SUCCEED();
}

REGISTER_TYPED_TEST_SUITE_P(TypedTestP, DoesBlah, HasPropertyA);

using MyTypes = ::testing::Types<char, int, unsigned int>;
INSTANTIATE_TYPED_TEST_SUITE_P(InstanceP, TypedTestP, MyTypes);

using MyOtherTypes = ::testing::Types<float, double>;
INSTANTIATE_TYPED_TEST_SUITE_P(OtherInstanceP, TypedTestP, MyOtherTypes);