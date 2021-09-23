#include <gtest/gtest.h>

template <typename T>
class TypedTest : public testing::Test
{
};

TYPED_TEST_SUITE_P(TypedTest);

TYPED_TEST_P(TypedTest, DoesBlah)
{
    SUCCEED();
}

TYPED_TEST_P(TypedTest, HasPropertyA)
{
    SUCCEED();
}

REGISTER_TYPED_TEST_SUITE_P(TypedTest, DoesBlah, HasPropertyA);

using MyTypes = ::testing::Types<char, int, unsigned int>;
INSTANTIATE_TYPED_TEST_SUITE_P(Instance, TypedTest, MyTypes);
